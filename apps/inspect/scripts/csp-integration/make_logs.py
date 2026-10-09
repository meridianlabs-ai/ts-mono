"""Write the CSP integration fixture logs with a real (mockllm) inspect eval.

Usage: python make_logs.py <log_dir>

The eval's samples carry what the policy has to allow: MathJax, data: image,
audio and video, a human-baseline terminal session (asciinema), and one
sample large enough that the viewer parses it in the JSON worker (over 50k
chars) and decompresses it in the decompression worker (over 1 MiB). The
.eval (zstd, inspect's default) is also written re-zipped with DEFLATE and
as .json, so every read path is covered.
"""

import re
import sys
import zipfile
from pathlib import Path

from inspect_ai import Task, eval
from inspect_ai.dataset import Sample
from inspect_ai.log import read_eval_log, write_eval_log
from inspect_ai.model import (
    ChatMessageAssistant,
    ChatMessageUser,
    ContentAudio,
    ContentImage,
    ContentText,
    ContentVideo,
)
from inspect_ai.solver import Generate, Solver, TaskState, solver
from inspect_ai.util import store

MEDIA = (Path(__file__).parents[2] / "e2e" / "csp" / "media.ts").read_text()


def media(name: str) -> str:
    match = re.search(rf'{name} =\s*"([^"]+)"', MEDIA)
    assert match, name
    return match.group(1)


TERMINAL_TEXT = "csp-terminal-ok"
HEADER = 'Script started on 2026-01-01 00:00:00+00:00 [COLUMNS="40" LINES="6"]\n'
OUTPUT = f"{HEADER}{TERMINAL_TEXT}\r\n"


@solver
def fixture() -> Solver:
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        state.messages.append(
            ChatMessageUser(
                content=[
                    ContentText(text="Describe these."),
                    ContentImage(image=media("kPngDataUri")),
                    ContentAudio(audio=media("kWavDataUri"), format="wav"),
                    ContentVideo(video=media("kMp4DataUri"), format="mp4"),
                ]
            )
        )
        state.messages.append(
            ChatMessageAssistant(
                content="Inline $x^2 + \\href{https://example.com/}{y}$ and display:"
                "\n\n$$\\frac{1}{2} = \\sum_{n=1}^{\\infty} 2^{-n-1} \\cdot 2$$"
            )
        )
        # Past both worker thresholds once serialized.
        state.messages.append(ChatMessageAssistant(content="padding " * 180_000))
        store().set(
            "HumanAgentState:logs",
            {
                "user_1700000000_000001.input": HEADER,
                "user_1700000000_000001.output": OUTPUT,
                "user_1700000000_000001.timing": f"O 0.05 {len(OUTPUT) - len(HEADER)}\n",
            },
        )
        store().set("HumanAgentState:answer", "done")
        return state

    return solve


def main(log_dir: str) -> None:
    task = Task(
        name="csp_fixture",
        dataset=[Sample(id="media", input="media"), Sample(id="other", input="x")],
        solver=fixture(),
    )
    [log] = eval(task, model="mockllm/model", log_dir=log_dir, display="none")
    assert log.status == "success", log.error
    eval_path = Path(log.location)
    json_path = eval_path.with_suffix(".json")
    write_eval_log(read_eval_log(log.location), str(json_path))
    deflate_path = eval_path.with_name(f"{eval_path.stem}-deflate.eval")
    with (
        zipfile.ZipFile(eval_path) as source,
        zipfile.ZipFile(deflate_path, "w", zipfile.ZIP_DEFLATED) as target,
    ):
        for info in source.infolist():
            target.writestr(info.filename, source.read(info))
    for path in (eval_path, deflate_path, json_path):
        print(path)


if __name__ == "__main__":
    main(sys.argv[1])
