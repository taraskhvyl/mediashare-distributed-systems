import base64
import json

from openai import OpenAI
from opentelemetry import trace
from pydantic import BaseModel

from config import Config

tracer = trace.get_tracer("tagger")

MAX_TAGS = 6
# Counts reasoning tokens too, so a tiny limit makes the answer come back `incomplete`.
MAX_OUTPUT_TOKENS = 1500
PROMPT = (
    "Describe this image for a photo-sharing app. "
    f"Give a caption of one plain sentence, and up to {MAX_TAGS} lowercase one-word tags."
)


class ImageDescription(BaseModel):
    """The shape the model must answer in (OpenAI Structured Outputs)."""

    caption: str
    tags: list[str]


class ModelAnswerError(Exception):
    """The model answered, but not with a usable description (refusal, cut off)."""


class ImageDescriber:
    """Adapter around OpenAI. Retries 429/5xx/timeouts itself (SDK backoff, honors Retry-After)."""

    def __init__(self, cfg: Config):
        self.model = cfg.openai_model
        self._client = OpenAI(
            api_key=cfg.openai_api_key,
            max_retries=cfg.openai_max_retries,
            timeout=cfg.openai_timeout_seconds,
        )

    def describe(self, image: bytes, content_type: str) -> ImageDescription:
        # A hand-made span following the OTel GenAI conventions: the auto-instrumentation
        # for openai doesn't install against the current opentelemetry-util-genai. Langfuse
        # reads model, input, output and usage from these gen_ai.* attributes.
        # The image bytes are deliberately NOT in the trace.
        attributes = {
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": "openai",
            "gen_ai.request.model": self.model,
            "gen_ai.prompt": json.dumps(
                [{"role": "user", "content": PROMPT, "image": f"{content_type}, {len(image)} bytes"}]
            ),
        }
        with tracer.start_as_current_span("describe image", attributes=attributes) as span:
            response = self._client.responses.parse(
                model=self.model,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": PROMPT},
                            {"type": "input_image", "image_url": _data_url(image, content_type)},
                        ],
                    }
                ],
                text_format=ImageDescription,
                max_output_tokens=MAX_OUTPUT_TOKENS,
            )
            if response.usage:
                span.set_attribute("gen_ai.usage.input_tokens", response.usage.input_tokens)
                span.set_attribute("gen_ai.usage.output_tokens", response.usage.output_tokens)
            span.set_attribute("gen_ai.response.model", response.model)

            description = response.output_parsed
            if response.status == "incomplete" or description is None:
                raise ModelAnswerError(f"no usable answer (status={response.status})")
            description.tags = description.tags[:MAX_TAGS]
            span.set_attribute("gen_ai.completion", description.model_dump_json())
            return description


def _data_url(image: bytes, content_type: str) -> str:
    return f"data:{content_type};base64,{base64.b64encode(image).decode()}"
