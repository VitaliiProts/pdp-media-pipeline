"""Traces and metrics over OTLP/HTTP to the collector, like the Node services. The trace of a
dub job continues here through `traceparent`. Off without OTEL_EXPORTER_OTLP_ENDPOINT."""

from __future__ import annotations

import os

from fastapi import FastAPI


def configure_telemetry(app: FastAPI) -> None:
    if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return
    from opentelemetry import metrics, trace
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.botocore import BotocoreInstrumentor
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create(
        {
            "service.name": os.environ.get("OTEL_SERVICE_NAME", "audio-separate"),
            "service.version": os.environ.get("SERVICE_VERSION", "dev"),
            "deployment.environment": os.environ.get("DEPLOYMENT_ENVIRONMENT", "dev"),
        }
    )
    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(tracer_provider)
    metrics.set_meter_provider(
        MeterProvider(
            resource=resource,
            metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())],
        )
    )
    FastAPIInstrumentor.instrument_app(app, excluded_urls="/health/live,/health/ready")
    BotocoreInstrumentor().instrument()
