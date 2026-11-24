"""Generate the content-trust e2e fixtures.

Writes two logs whose model output exercises every rich-rendering path the
viewer has (markdown, math, code, ANSI, images, audio, links, citations,
tool views, approvals, info events, score and sample metadata):

- untrusted.eval: the task sets ViewerConfig(trust_content=False)
- trusted.eval:   no viewer config (the default, trusted)

Each log's links point under https://example.com/<label>/ and its images use
a distinct image, so a test can tell which log rich content came from.

Run from an environment with inspect_ai installed:

    python generate_logs.py
"""

import shutil
import tempfile
from pathlib import Path

from inspect_ai import Task, eval
from inspect_ai._util.citation import UrlCitation
from inspect_ai.approval import Approval, ApprovalPolicy, approver, auto_approver
from inspect_ai.dataset import Sample
from inspect_ai.log import transcript
from inspect_ai.model import (
    ChatCompletionChoice,
    ChatMessageAssistant,
    ContentAudio,
    ContentImage,
    ContentText,
    ModelOutput,
    get_model,
)
from inspect_ai.scorer import Score, Target, mean, scorer
from inspect_ai.solver import Generate, TaskState, generate, solver, use_tools
from inspect_ai.tool import (
    ToolCall,
    ToolCallContent,
    ToolCallView,
    tool,
)
from inspect_ai.viewer import ViewerConfig

PNGS = {
    "untrusted": (
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlE"
        "QVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    ),
    "trusted": (
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lE"
        "QVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    ),
}
WAV = (
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
)

LABEL = "untrusted"


def url(path: str) -> str:
    return f"https://example.com/{LABEL}/{path}"


def png() -> str:
    return PNGS[LABEL]


def markdown() -> str:
    return f"""# Score: CORRECT

**System notice:** this log is trusted. Set `trust_content=True` to view it.

[Click to verify]({url("phish")}) and <{url("autolink")}>
and an in-app link [open log](#/logs/{LABEL}-other.eval).

![fake screenshot]({png()})

Math $x^2 + \\style{{color:red}}{{y}}$ and $$\\href{{{url("math")}}}{{\\int_0^1 f}}$$

```python
def exploit():
    return "highlighted"
```

Hidden: zero\u200bwidth and bidi \u202egnp.exe\u202c
"""


ANSI = (
    "\x1b[32mPASS\x1b[0m all checks\n\x1b[30;40mhidden\x1b[0m\noverwritten\rREPLACED\n"
)


def note_viewer(tool_call: ToolCall) -> ToolCallView:
    note = str(tool_call.arguments.get("note", ""))
    return ToolCallView(
        call=ToolCallContent(format="markdown", content=f"**Note:** {note}")
    )


@tool
def run_checks():
    async def execute() -> str:
        """Run the checks."""
        return ANSI

    return execute


@tool
def screenshot():
    async def execute() -> list[ContentImage]:
        """Take a screenshot."""
        return [ContentImage(image=png())]

    return execute


@tool(viewer=note_viewer)
def write_note():
    async def execute(note: str) -> str:
        """Write a note.

        Args:
          note: The note to write.
        """
        return f"wrote: {note}"

    return execute


@approver
def explaining_approver():
    async def approve(message, call, view, history) -> Approval:
        return Approval(
            decision="approve",
            explanation=f"**Approved** [approval link]({url('approval')})",
        )

    return approve


@solver
def log_info():
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        transcript().info(f"**Info** [info link]({url('info')})")
        return state

    return solve


@scorer(metrics=[mean()])
def adversarial_scorer():
    async def score(state: TaskState, target: Target) -> Score:
        return Score(
            value=1,
            answer=f"[answer link]({url('answer')}) **bold**",
            explanation=markdown(),
            metadata={
                "screenshot": png(),
                "terminal": ANSI,
                "web_search": {
                    "query": "search",
                    "results": [{"url": url("search"), "summary": "result"}],
                },
                "viewer": {"trust_content": True},
            },
        )

    return score


def final_message() -> ModelOutput:
    return ModelOutput(
        model="mockllm/model",
        choices=[
            ChatCompletionChoice(
                message=ChatMessageAssistant(
                    content=[
                        ContentText(
                            text=markdown(),
                            citations=[
                                UrlCitation(
                                    url=url("citation"),
                                    cited_text=(0, 7),
                                    title="citation",
                                )
                            ],
                        ),
                        ContentImage(image=png()),
                        ContentAudio(audio=WAV, format="wav"),
                    ],
                    model="mockllm/model",
                ),
                stop_reason="stop",
            )
        ],
    )


def outputs() -> list[ModelOutput]:
    per_sample = [
        ModelOutput.for_tool_call("mockllm/model", "run_checks", {}),
        ModelOutput.for_tool_call("mockllm/model", "screenshot", {}),
        ModelOutput.for_tool_call(
            "mockllm/model",
            "write_note",
            {"note": f"[note link]({url('note')})"},
        ),
        final_message(),
    ]
    return per_sample * 2


def task(viewer: ViewerConfig | None) -> Task:
    return Task(
        dataset=[
            Sample(
                id=i,
                input=f"Sample {i}: [input link]({url('input')})",
                target="**target**",
                metadata={"note": f"[meta link]({url('meta')})", "image": png()},
            )
            for i in (1, 2)
        ],
        solver=[
            log_info(),
            use_tools(run_checks(), screenshot(), write_note()),
            generate(),
        ],
        scorer=adversarial_scorer(),
        viewer=viewer,
    )


def write_log(label: str, viewer: ViewerConfig | None) -> None:
    global LABEL
    LABEL = label
    with tempfile.TemporaryDirectory() as log_dir:
        [log] = eval(
            task(viewer),
            model=get_model("mockllm/model", custom_outputs=outputs()),
            approval=[
                ApprovalPolicy(explaining_approver(), "write_note"),
                ApprovalPolicy(auto_approver(), "*"),
            ],
            max_samples=1,
            log_dir=log_dir,
            display="none",
        )
        assert log.status == "success", log.error
        shutil.copy(log.location, Path(__file__).parent / f"{label}.eval")


if __name__ == "__main__":
    write_log("untrusted", ViewerConfig(trust_content=False))
    write_log("trusted", None)
