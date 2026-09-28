// Prism highlights the whole document when it loads unless `Prism.manual` is
// set before it evaluates. Set it so Prism only runs where the viewer calls it
// (usePrismHighlight, for trusted content).
Object.assign(globalThis, { Prism: { manual: true } });

export {};
