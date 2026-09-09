// Plain (non-module) stylesheet imports exist only for their bundler side
// effect. Empty module shape on purpose: a *.module.css import whose
// generated .d.ts is missing then fails loudly instead of decaying to any.
// (Apps must not reference "vite/client" — its *.module.css wildcard would
// win over this and silently degrade missing typings to a string record;
// they reference vite/types/import-meta.d.ts instead.)
declare module "*.css" {}
