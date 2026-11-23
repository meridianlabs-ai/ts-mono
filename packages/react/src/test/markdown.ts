/**
 * Imports the markdown pipeline that `MarkdownDiv` loads on first trusted
 * render. Await it in `beforeAll` in a test file that waits on rendered
 * markdown: the cold import can take seconds on a loaded runner, longer
 * than `waitFor`'s default timeout. It sits outside the `./testing` barrel
 * so vitest's watch mode doesn't tie every importer of that barrel to the
 * pipeline.
 */
export const loadMarkdownPipeline = async (): Promise<void> => {
  await import("../components/markdownPipeline");
};
