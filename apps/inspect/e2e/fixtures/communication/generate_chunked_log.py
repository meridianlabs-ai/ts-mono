"""Generate swarm-chunked.eval, swarm.eval converted to chunked samples.

The viewer downloads a chunked sample whole only when it has producer
timelines and is under 50 MiB; otherwise it reads the sample in windows. This
copy drops the samples' timelines before converting, so the swarm sample takes
the windowed path, as a larger one would. chunk_size=3 spreads the
communication over many chunks, with chunks between them that hold none.

Run from an environment with inspect_ai installed:

    python generate_chunked_log.py
"""

import tempfile
from pathlib import Path

from inspect_ai.log import read_eval_log, write_eval_log
from inspect_ai.log._recorders.chunked import convert_eval_logs_to_chunked


def main() -> None:
    here = Path(__file__).parent
    log = read_eval_log(str(here / "swarm.eval"))
    for sample in log.samples or []:
        sample.timelines = None
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "swarm-chunked.eval"
        write_eval_log(log, str(source))
        convert_eval_logs_to_chunked(
            str(source), str(here), overwrite=True, chunk_size=3
        )


if __name__ == "__main__":
    main()
