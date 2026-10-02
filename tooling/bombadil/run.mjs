import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** @param {import('./run.d.mts').BombadilOptions} options */
export async function runBombadil(options) {
  await mkdir(options.output, { recursive: true });
  const logs = [];
  const code = await new Promise((resolveExit, reject) => {
    // Spawn the binary directly so a timeout terminates the explorer too.
    const binary = resolve(
      `node_modules/@antithesishq/bombadil/binaries/bombadil-${process.platform}-${process.arch}`
    );
    const replay = process.env.BOMBADIL_REPRODUCE;
    const child = spawn(
      binary,
      [
        "browser",
        "test-external",
        "--remote-debugger",
        `http://localhost:${options.debuggerPort}`,
        ...(replay
          ? ["--reproduce", resolve(replay)]
          : [
              "--time-limit",
              process.env.BOMBADIL_TIME ?? "2m",
              "--exit-on-violation",
            ]),
        "--output-path",
        options.output,
        "--instrument-javascript",
        "",
        options.origin,
        resolve(options.specification),
      ],
      { timeout: 540_000, killSignal: "SIGKILL" }
    );
    child.stdout.on("data", (data) => logs.push(data.toString()));
    child.stderr.on("data", (data) => logs.push(data.toString()));
    child.on("error", reject);
    child.on("close", resolveExit);
  });
  const log = logs.join("");
  await writeFile(resolve(options.output, "run.log"), log);
  return { code, log };
}
