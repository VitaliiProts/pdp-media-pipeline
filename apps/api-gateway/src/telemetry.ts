import { startTelemetry } from '@pdp/observability/telemetry';

// The public edge: context sent by clients is not trusted, a request starts a new trace.
startTelemetry({ serviceName: 'api-gateway', edge: true });
