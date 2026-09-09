import { defineConfig, mergeConfig } from "vite";

import { rewriteLoopbackOrigin } from "../../../../../tooling/vite-plugins/index.js";
import base from "../../../vite.config.ts";

// The app's own dev config pins the /api proxy to 7575 — the port a user's
// real `inspect view` owns. Verification runs its own view server on a
// dedicated port so it never reads (or disturbs) the user's session.
const viewServerUrl = `http://127.0.0.1:${process.env.VERIFY_VIEW_SERVER_PORT ?? "7677"}`;
const viewerPort = Number(process.env.VERIFY_VIEWER_PORT ?? "5179");

export default defineConfig((env) =>
  mergeConfig(base(env), {
    server: {
      port: viewerPort,
      strictPort: true,
      proxy: {
        "/api": {
          target: viewServerUrl,
          changeOrigin: true,
          configure: rewriteLoopbackOrigin(viewServerUrl),
        },
      },
    },
  })
);
