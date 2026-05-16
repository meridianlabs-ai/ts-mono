// postcss.config.js
module.exports = {
  plugins: [
    require("postcss-url")({
      url: "inline",
      // Inline small assets (icons, decorative images) to avoid extra
      // requests, but emit larger ones (icon fonts especially) as separate
      // files so they don't bloat the critical CSS payload.
      maxSize: 8,
      fallback: "copy",
    }),
  ],
};
