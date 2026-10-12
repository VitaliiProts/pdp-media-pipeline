import { lookup as dnsLookup } from 'node:dns/promises';
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import { isPublicAddress } from './address-policy';
import { HostConcurrencyLimiter } from './host-limiter';

const tracer = trace.getTracer('@pdp/egress');

export type EgressErrorCode =
  | 'INVALID_URL'
  | 'BLOCKED_ADDRESS'
  | 'RESOLVE_FAILED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'TOO_LARGE'
  | 'TOO_MANY_REDIRECTS';

const PERMANENT_CODES: ReadonlySet<EgressErrorCode> = new Set([
  'INVALID_URL',
  'BLOCKED_ADDRESS',
  'TOO_LARGE',
  'TOO_MANY_REDIRECTS',
]);

/** `permanent` follows the worker convention: retrying the same request cannot succeed. */
export class EgressError extends Error {
  readonly permanent: boolean;

  constructor(
    readonly code: EgressErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EgressError';
    this.permanent = PERMANENT_CODES.has(code);
  }
}

export type StatusClass = 'success' | 'permanent' | 'transient';

/** Client errors that mean "not now" rather than "never". */
const RETRYABLE_4XX: ReadonlySet<number> = new Set([408, 409, 425, 429]);

export function classifyStatus(status: number): StatusClass {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 500 || RETRYABLE_4XX.has(status)) return 'transient';
  return 'permanent';
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface EgressClientOptions {
  /** Whole exchange, redirects and body included. */
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
  perHostConcurrency: number;
  /** Host names allowed to resolve to private addresses, e.g. an in-cluster test receiver. */
  privateHosts?: readonly string[];
  userAgent: string;
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
}

export interface EgressRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxBytes?: number;
  /** Streams the body here instead of buffering it; `body` in the response is then empty. */
  sink?: Writable;
  signal?: AbortSignal;
}

export interface EgressResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  bytes: number;
  /** After redirects. */
  url: string;
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const defaultResolve = (hostname: string): Promise<ResolvedAddress[]> =>
  dnsLookup(hostname, { all: true, verbatim: true });

/** Connects to exactly the address that passed the policy, so DNS cannot change in between. */
const pinnedLookup =
  ({ address, family }: ResolvedAddress): LookupFunction =>
  (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };

const stripBrackets = (hostname: string): string =>
  hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

/**
 * Outbound HTTP for user-supplied URLs (job sources, webhook endpoints). Guards against SSRF:
 * only http(s), every hop (redirects included) must resolve to public addresses, and the
 * connection goes to the validated address. Bounded by a deadline, a byte cap and a
 * per-host concurrency limit.
 */
export class EgressClient {
  private readonly limiter: HostConcurrencyLimiter;
  private readonly privateHosts: ReadonlySet<string>;
  private readonly resolve: (hostname: string) => Promise<ResolvedAddress[]>;

  constructor(private readonly options: EgressClientOptions) {
    this.limiter = new HostConcurrencyLimiter(options.perHostConcurrency);
    this.privateHosts = new Set((options.privateHosts ?? []).map((h) => h.toLowerCase()));
    this.resolve = options.resolve ?? defaultResolve;
  }

  /** Fails like `request` would before connecting; for early validation at the API edge. */
  async check(rawUrl: string): Promise<void> {
    await this.resolveTarget(parseUrl(rawUrl));
  }

  /**
   * One CLIENT span for the whole exchange, redirects included. Only the host is recorded,
   * since paths and queries of webhook URLs often hold tokens. Tracing is suppressed below
   * the span, so no `traceparent` or `baggage` (job ids) leaks to a third-party server.
   */
  async request(rawUrl: string, req: EgressRequest = {}): Promise<EgressResponse> {
    const url = parseUrl(rawUrl);
    const method = req.method ?? 'GET';
    return tracer.startActiveSpan(
      `egress ${method}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'http.request.method': method,
          'server.address': url.hostname,
          'url.scheme': url.protocol.slice(0, -1),
        },
      },
      async (span) => {
        try {
          const res = await context.with(suppressTracing(context.active()), () =>
            this.exchange(url, req),
          );
          span.setAttributes({
            'http.response.status_code': res.status,
            'http.response.body.size': res.bytes,
          });
          if (res.status >= 400) span.setStatus({ code: SpanStatusCode.ERROR });
          return res;
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
          if (err instanceof EgressError) span.setAttribute('error.type', err.code);
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  private exchange(initialUrl: URL, req: EgressRequest): Promise<EgressResponse> {
    let url = initialUrl;
    const deadline = AbortSignal.timeout(req.timeoutMs ?? this.options.timeoutMs);
    const signal = req.signal ? AbortSignal.any([deadline, req.signal]) : deadline;
    const maxRedirects = this.options.maxRedirects ?? 3;

    return this.limiter.run(url, async () => {
      try {
        for (let redirects = 0; ; redirects++) {
          const target = await this.resolveTarget(url);
          const res = await this.send(url, target, req, signal);
          const location = res.headers.location;
          const status = res.statusCode ?? 0;
          if (REDIRECT_STATUSES.has(status) && location && (req.method ?? 'GET') === 'GET') {
            res.resume();
            if (redirects >= maxRedirects) {
              throw new EgressError('TOO_MANY_REDIRECTS', `more than ${maxRedirects} redirects`);
            }
            url = parseUrl(new URL(location, url).toString());
            continue;
          }
          return await this.readBody(url, res, req);
        }
      } catch (err) {
        if (err instanceof EgressError) throw err;
        if (deadline.aborted) throw new EgressError('TIMEOUT', `${url.host} timed out`);
        throw new EgressError('NETWORK', `${url.host}: ${(err as Error).message}`);
      }
    });
  }

  private async resolveTarget(url: URL): Promise<ResolvedAddress> {
    const hostname = stripBrackets(url.hostname).toLowerCase();
    const allowPrivate = this.privateHosts.has(hostname);
    const literal = isIP(hostname);
    if (literal !== 0) {
      if (!allowPrivate && !isPublicAddress(hostname)) {
        throw new EgressError('BLOCKED_ADDRESS', `${hostname} is not a public address`);
      }
      return { address: hostname, family: literal };
    }

    let addresses: ResolvedAddress[];
    try {
      addresses = await this.resolve(hostname);
    } catch (err) {
      throw new EgressError('RESOLVE_FAILED', `${hostname}: ${(err as Error).message}`);
    }
    const first = addresses[0];
    if (!first) throw new EgressError('RESOLVE_FAILED', `${hostname} has no addresses`);
    if (!allowPrivate && addresses.some((a) => !isPublicAddress(a.address))) {
      throw new EgressError('BLOCKED_ADDRESS', `${hostname} resolves to a non-public address`);
    }
    return first;
  }

  private send(
    url: URL,
    target: ResolvedAddress,
    req: EgressRequest,
    signal: AbortSignal,
  ): Promise<IncomingMessage> {
    const transport = url.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = { 'user-agent': this.options.userAgent };
    Object.assign(headers, req.headers);
    if (req.body !== undefined) headers['content-length'] = String(Buffer.byteLength(req.body));

    return new Promise((resolve, reject) => {
      const outgoing = transport.request(
        {
          protocol: url.protocol,
          hostname: stripBrackets(url.hostname),
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: req.method ?? 'GET',
          headers,
          lookup: pinnedLookup(target),
          // A pooled socket could outlive the address check that opened it.
          agent: false,
          signal,
        },
        resolve,
      );
      outgoing.on('error', reject);
      outgoing.end(req.body);
    });
  }

  private async readBody(
    url: URL,
    res: IncomingMessage,
    req: EgressRequest,
  ): Promise<EgressResponse> {
    const maxBytes = req.maxBytes ?? this.options.maxBytes;
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.destroy();
      throw new EgressError('TOO_LARGE', `${url.host} sent ${declared} bytes, limit ${maxBytes}`);
    }

    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          callback(new EgressError('TOO_LARGE', `${url.host} sent over ${maxBytes} bytes`));
        } else {
          callback(null, chunk);
        }
      },
    });
    const chunks: Buffer[] = [];
    const sink =
      req.sink ??
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });

    await pipeline(res, counter, sink);
    return {
      status: res.statusCode ?? 0,
      headers: res.headers,
      body: Buffer.concat(chunks),
      bytes,
      url: url.toString(),
    };
  }
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EgressError('INVALID_URL', 'not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EgressError('INVALID_URL', `scheme ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) {
    throw new EgressError('INVALID_URL', 'credentials in the URL are not allowed');
  }
  return url;
}
