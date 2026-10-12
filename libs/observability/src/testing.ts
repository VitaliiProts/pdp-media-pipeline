import { type Attributes, context, metrics, propagation, trace } from '@opentelemetry/api';
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
import { type DataPoint, MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
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

export interface TestMetricPoint {
  attributes: Attributes;
  /** A counter's sum, a gauge's value or a histogram's count. */
  value: number;
}

export interface TestMetrics {
  points: (name: string) => Promise<TestMetricPoint[]>;
  /** Point values added up over the points whose attributes include `attributes`. */
  value: (name: string, attributes?: Attributes) => Promise<number>;
  stop: () => Promise<void>;
}

class ManualReader extends MetricReader {
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/** A global meter provider read on demand. Start it before the apps under test. */
export function startTestMetrics(): TestMetrics {
  const reader = new ManualReader();
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);

  const points = async (name: string): Promise<TestMetricPoint[]> => {
    const { resourceMetrics } = await reader.collect();
    return resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.descriptor.name === name)
      .flatMap((metric) => metric.dataPoints as DataPoint<number | { count: number }>[])
      .map((point) => ({
        attributes: point.attributes,
        value: typeof point.value === 'number' ? point.value : point.value.count,
      }));
  };

  return {
    points,
    value: async (name, attributes = {}) =>
      (await points(name))
        .filter((point) =>
          Object.entries(attributes).every(([key, value]) => point.attributes[key] === value),
        )
        .reduce((total, point) => total + point.value, 0),
    stop: async () => {
      await provider.shutdown();
      metrics.disable();
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
