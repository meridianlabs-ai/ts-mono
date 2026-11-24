// Loaded on demand by usePrismHighlight, so Prism is never fetched or run
// unless trusted content needs highlighting. prismManual must come first.
import "./prismManual";
import "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/components/prism-yaml";

export { highlightElement } from "prismjs";
