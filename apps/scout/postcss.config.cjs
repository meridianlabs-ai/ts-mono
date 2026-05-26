// postcss.config.js
//
// postcss-url's `fallback: "copy"` needs the postcss `to` option to compute
// where to emit external assets — only set during production builds. In dev,
// Vite handles url() references natively, so this plugin would just warn and
// no-op. Returning an empty plugin list in dev keeps the console clean.
module.exports = (ctx) => ({
  plugins:
    ctx.env === "production"
      ? [
          require("postcss-url")({
            url: "inline",
            // Inline small assets (icons, decorative images) to avoid extra
            // requests, but emit larger ones (icon fonts especially) as
            // separate files so they don't bloat the critical CSS payload.
            maxSize: 8,
            fallback: "copy",
          }),
        ]
      : [],
});
