// import.meta typings only — deliberately not "vite/client": its ambient
// `*.module.css` wildcard would silently type any css-module import whose
// generated .d.ts is missing as a string record instead of failing loudly.
/// <reference types="vite/types/import-meta.d.ts" />

declare const __VIEW_SERVER_API_URL__: string;
