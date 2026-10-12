import { context, propagation, trace } from '@opentelemetry/api';
import { BaggageSpanProcessor } from '@opentelemetry/baggage-span-processor';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { isWrapped, registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { JOB_BAGGAGE_PREFIX } from './tracing';

export interface TestTracing {
  spans: () => ReadableSpan[];
  reset: () => void;
  stop: () => Promise<void>;
}

/**
 * Global tracing into memory, with the same propagators and baggage handling as the
 * real SDK. `http` and `fetch` are instrumented too when `instrumentHttp` is set, so
 * context crosses service boundaries in in-process integration tests.
 */
export function startTestTracing({ instrumentHttp = false } = {}): TestTracing {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [
      new BaggageSpanProcessor((key) => key.startsWith(JOB_BAGGAGE_PREFIX)),
      new SimpleSpanProcessor(exporter),
    ],
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );
  trace.setGlobalTracerProvider(provider);
  let unregister = (): void => undefined;
  if (instrumentHttp) {
    const http = new HttpInstrumentation({ requireParentforOutgoingSpans: true });
    unregister = registerInstrumentations({
      tracerProvider: provider,
      instrumentations: [http, new UndiciInstrumentation({ requireParentforSpans: true })],
    });
    const unpatch = patchCoreModules(http);
    const unregisterHooks = unregister;
    unregister = () => {
      unpatch();
      unregisterHooks();
    };
  }

  return {
    spans: () => exporter.getFinishedSpans(),
    reset: () => exporter.reset(),
    stop: async () => {
      unregister();
      await provider.shutdown();
      trace.disable();
      propagation.disable();
      context.disable();
    },
  };
}

/**
 * Jest hands its own `module` to the require hook, so `http` is never patched on load.
 * Applies the instrumentation's patches to the real modules instead.
 */
function patchCoreModules(instrumentation: HttpInstrumentation): () => void {
  const undo: (() => void)[] = [];
  for (const definition of instrumentation.getModuleDefinitions()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exports = require(definition.name) as { request: unknown };
    if (isWrapped(exports.request)) continue;
    definition.patch?.(exports, process.versions.node);
    undo.push(() => definition.unpatch?.(exports, process.versions.node));
  }
  return () => undo.forEach((fn) => fn());
}
