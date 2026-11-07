// The harness's JSON parse worker entry; an app's entry is the same two lines.
import { serveJsonParseRequests } from "../src/json-parse-worker-scope";

serveJsonParseRequests(self);
