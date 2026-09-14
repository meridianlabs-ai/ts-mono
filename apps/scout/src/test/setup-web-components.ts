// jsdom gaps the real @vscode-elements web components hit, so component
// tests can render them instead of stubbing the dependency. Guarded because
// setup files also run for node-environment tests.
if (typeof HTMLElement !== "undefined") {
  // Form-associated elements (textfield, checkbox, radio, multi-select) call
  // attachInternals(), which jsdom does not implement.
  await import("element-internals-polyfill");

  // vscode-select-base reads option labels through innerText, which jsdom
  // leaves undefined.
  if (!("innerText" in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      configurable: true,
      get(this: HTMLElement): string {
        return this.textContent;
      },
      set(this: HTMLElement, value: string) {
        this.textContent = value;
      },
    });
  }

  // vscode-form-helper pushes a light-DOM stylesheet onto
  // document.adoptedStyleSheets in its constructor. Shim the instance only:
  // Lit checks Document.prototype to decide whether to adopt stylesheets,
  // and its <style> fallback is what jsdom can actually hold.
  if (!Reflect.has(document, "adoptedStyleSheets")) {
    Object.defineProperty(document, "adoptedStyleSheets", {
      configurable: true,
      value: [],
    });
  }

  if (typeof ResizeObserver === "undefined") {
    const { ResizeObserverStub } = await import("@tsmono/react/testing");
    Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
  }
}

// Top-level await needs a module; nothing is exported on purpose.
export {};
