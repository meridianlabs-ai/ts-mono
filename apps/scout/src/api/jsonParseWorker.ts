import { configureJsonParseWorker } from "@tsmono/util";

import jsonParseWorkerUrl from "./json-parse.worker?worker&url";

// Resolved here rather than in @tsmono/util so that package stays importable
// outside a bundler.
configureJsonParseWorker(jsonParseWorkerUrl);
