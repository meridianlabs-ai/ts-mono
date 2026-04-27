/**
 * Vite plugin: generate sibling `.d.ts` for every `*.module.css` file
 * Vite touches. Gives editors and tsc precise class types instead of the
 * loose `Readonly<Record<string, string>>` you get from the default
 * ambient declaration.
 *
 * CI relies on `tcm -p '**\/*.module.css' src` (see each package's
 * `typecheck` script). This plugin handles the dev-server watch loop.
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const DtsCreator = require("typed-css-modules").default;

const CSS_MODULE_RE = /\.module\.css(?:\?.*)?$/;

function stripQuery(id) {
  const q = id.indexOf("?");
  return q === -1 ? id : id.slice(0, q);
}

export function cssModulesDts() {
  // rootDir="/" + outDir="" means writeFile drops `${absPath}.d.ts` next
  // to the source file, regardless of which package the CSS lives in.
  const creator = new DtsCreator({
    rootDir: "/",
    searchDir: "",
    outDir: "",
  });
  const inFlight = new Map();

  async function generate(absFile) {
    let p = inFlight.get(absFile);
    if (p) return p;
    p = (async () => {
      try {
        const content = await creator.create(absFile, undefined, true);
        await content.writeFile();
      } catch (err) {
        console.warn(
          `[css-modules-dts] ${absFile}: ${err?.message ?? err}`,
        );
      } finally {
        inFlight.delete(absFile);
      }
    })();
    inFlight.set(absFile, p);
    return p;
  }

  return {
    name: "css-modules-dts",
    async transform(_code, id) {
      const file = stripQuery(id);
      if (!CSS_MODULE_RE.test(file)) return;
      await generate(file);
    },
    async handleHotUpdate({ file }) {
      if (!CSS_MODULE_RE.test(file)) return;
      await generate(file);
    },
  };
}
