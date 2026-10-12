import { type Context, type TextMapPropagator } from '@opentelemetry/api';
import { BaggageSpanProcessor } from '@opentelemetry/baggage-span-processor';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { type Instrumentation } from '@opentelemetry/instrumentation';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { JOB_BAGGAGE_PREFIX } from '../tracing';

export interface TelemetryOptions {
  serviceName: string;
  /**
   * The public entry point: ignore trace context and baggage sent by clients, so nobody
   * outside can join our traces, force sampling or put a `job.id` into our logs. Context
   * is still sent on to internal services.
   */
  edge?: boolean;
}

const NOISY_PATHS = /^\/health\b/;

/** Injects like W3C trace context, but never takes context from the caller. */
class OutboundOnlyPropagator implements TextMapPropagator {
  private readonly inner = new W3CTraceContextPropagator();
  inject: TextMapPropagator['inject'] = (context, carrier, setter) =>
    this.inner.inject(context, carrier, setter);
  extract = (context: Context): Context => context;
  fields = (): string[] => this.inner.fields();
}

/** Exports to the collector would otherwise show up in the HTTP client metrics. */
function collectorHost(): string | undefined {
  try {
    return new URL(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318').hostname;
  } catch {
    return undefined;
  }
}

function instrumentations(): Instrumentation[] {
  const collector = collectorHost();
  return [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) => NOISY_PATHS.test(req.url ?? ''),
      ignoreOutgoingRequestHook: (req) => (req.hostname ?? req.host) === collector,
      requireParentforOutgoingSpans: true,
    }),
    // Background loops (outbox polling, readiness pings) would otherwise start a root
    // trace every few hundred milliseconds.
    new UndiciInstrumentation({ requireParentforSpans: true }),
    new PgInstrumentation({ requireParentSpan: true }),
    new IORedisInstrumentation({ requireParentSpan: true }),
    new AwsInstrumentation({ suppressInternalInstrumentation: true }),
    new PinoInstrumentation(),
    new NestInstrumentation(),
    new RuntimeNodeInstrumentation(),
  ];
}

let sdk: NodeSDK | undefined;

/**
 * Must run before anything else is imported: instrumentations patch `http`, `pg`, `pino`
 * and others when they are first required. Each `main.ts` imports a `telemetry.ts` first.
 * Endpoint and switches come from the standard env, e.g. `OTEL_EXPORTER_OTLP_ENDPOINT`
 * and `OTEL_SDK_DISABLED`.
 */
export function startTelemetry({ serviceName, edge = false }: TelemetryOptions): void {
  if (sdk || process.env.OTEL_SDK_DISABLED === 'true') return;
  sdk = new NodeSDK({
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 15_000),
      }),
    ],
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env.SERVICE_VERSION ?? 'dev',
      'deployment.environment.name': process.env.DEPLOYMENT_ENVIRONMENT ?? 'local',
    }),
    spanProcessors: [
      new BaggageSpanProcessor((key) => key.startsWith(JOB_BAGGAGE_PREFIX)),
      new BatchSpanProcessor(new OTLPTraceExporter()),
    ],
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    ...(edge ? { textMapPropagator: new OutboundOnlyPropagator() } : {}),
    instrumentations: instrumentations(),
  });
  sdk.start();
}

/** Flushes buffered spans, logs and metrics; called on application shutdown. */
export async function shutdownTelemetry(): Promise<void> {
  const running = sdk;
  sdk = undefined;
  await running?.shutdown();
}
