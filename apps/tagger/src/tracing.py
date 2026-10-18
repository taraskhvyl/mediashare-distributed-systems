import base64

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from config import Config
from log import get

logger = get("tracing")

# Langfuse's OTLP endpoint takes HTTP (not gRPC); v4 makes spans show up right away
# (docs: langfuse.com/integrations/native/opentelemetry).
LANGFUSE_OTLP_PATH = "/api/public/otel/v1/traces"
LANGFUSE_INGESTION_VERSION = "4"
GEN_AI_MARKER = "gen_ai.operation.name"


class GenAiOnlySpanProcessor(BatchSpanProcessor):
    """Exports only LLM spans. Everything else (kafka, db, s3) already goes to Tempo and is
    noise in an LLM trace tool, and would leave internal details with a third party."""

    def on_end(self, span: ReadableSpan) -> None:
        if GEN_AI_MARKER in (span.attributes or {}):
            super().on_end(span)


def export_llm_spans_to_langfuse(cfg: Config) -> None:
    """A second OTLP exporter next to the one `opentelemetry-instrument` set up for lgtm.

    Same spans, same trace ids, two backends: a trace opened in Tempo can be found in Langfuse.
    """
    if not (cfg.langfuse_host and cfg.langfuse_public_key and cfg.langfuse_secret_key):
        logger.warning("Langfuse keys not set, LLM spans go to lgtm only")
        return
    credentials = f"{cfg.langfuse_public_key}:{cfg.langfuse_secret_key}"
    exporter = OTLPSpanExporter(
        endpoint=cfg.langfuse_host.rstrip("/") + LANGFUSE_OTLP_PATH,
        headers={
            "Authorization": "Basic " + base64.b64encode(credentials.encode()).decode(),
            "x-langfuse-ingestion-version": LANGFUSE_INGESTION_VERSION,
        },
    )
    trace.get_tracer_provider().add_span_processor(GenAiOnlySpanProcessor(exporter))
    logger.info("exporting LLM spans to Langfuse", extra={"ctx": {"host": cfg.langfuse_host}})
