"""Generate the communication e2e fixture, swarm.eval.

Sample "swarm" runs an inspect_swarm swarm of two scripted members, alice and
bob, over the messages and shared_memory channels: a long message (stored as
an attachment), a write, a broadcast refused by the rate control, a reply,
reads and waits. Sample "plain" has no communication.

Run from an environment with inspect_ai and inspect_swarm installed:

    python generate_log.py
"""

import shutil
import tempfile
from pathlib import Path

from inspect_ai import Task, eval
from inspect_ai.agent import as_solver, react
from inspect_ai.dataset import Sample
from inspect_ai.model import ModelOutput, get_model
from inspect_ai.solver import Generate, TaskState, solver
from inspect_swarm import (
    leaderless,
    member,
    messages,
    shared_memory,
    swarm,
    swarm_tools,
)

LONG_MESSAGE = "Hi bob, please check a.md.\nIt has the plan.\n" + "\n".join(
    f"step {i}" for i in range(40)
)


def scripted(name: str, *calls: tuple[str, dict[str, object]]):
    outputs = [ModelOutput.for_tool_call("mockllm", tool, args) for tool, args in calls]
    outputs.append(ModelOutput.for_tool_call("mockllm", "submit", {"answer": "done"}))
    model = get_model(f"mockllm/{name}", memoize=False, custom_outputs=outputs)
    return member(react(model=model, tools=[swarm_tools()]), name=name)


def two_member_swarm():
    return swarm(
        [
            scripted(
                "alice",
                ("send_message", {"to": "bob", "message": LONG_MESSAGE}),
                (
                    "shared_memory",
                    {
                        "command": "create",
                        "path": "/shared_memory/a.md",
                        "file_text": "the plan",
                    },
                ),
                # over the rate of one message an hour: refused
                ("send_message", {"to": "all", "message": "status: plan written"}),
                ("swarm_wait", {}),
                ("read_messages", {}),
            ),
            scripted(
                "bob",
                ("swarm_wait", {}),
                ("read_messages", {}),
                (
                    "send_message",
                    {
                        "to": "alice",
                        "message": "Got it, reading now.",
                        "reply_to": "m-1",
                    },
                ),
                ("shared_memory", {"command": "view", "path": "/shared_memory/a.md"}),
            ),
        ],
        controller=leaderless(stop_on_submission=False),
        channels=[messages(rate=(1, 3600.0)), shared_memory()],
    )


@solver
def swarm_or_generate():
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        if state.sample_id == "swarm":
            return await as_solver(two_member_swarm())(state, generate)
        return await generate(state)

    return solve


def main() -> None:
    task = Task(
        dataset=[Sample(id="swarm", input="task"), Sample(id="plain", input="task")],
        solver=swarm_or_generate(),
    )
    with tempfile.TemporaryDirectory() as log_dir:
        [log] = eval(task, model="mockllm/model", log_dir=log_dir, display="none")
        assert log.status == "success", log.error
        shutil.copy(log.location, Path(__file__).parent / "swarm.eval")


if __name__ == "__main__":
    main()
