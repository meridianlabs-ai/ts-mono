import clsx from "clsx";
import JSON5 from "json5";
import { FC, Fragment, isValidElement, JSX, ReactNode } from "react";

import {
  ANSIDisplay,
  ContentText,
  JSONPanel,
  MarkdownReference,
  RequireMedia,
} from "@tsmono/react/components";
import { Icon } from "@tsmono/react/icons";
import {
  formatNumber,
  isJson,
  isRecord,
  isRenderableImageSource,
} from "@tsmono/util";

import { ExternalLink } from "./ExternalLink";
import { isHtmlEscape } from "./htmlEscape";
import { MetaDataGrid } from "./MetaDataGrid";
import styles from "./RenderedContent.module.css";
import { RenderedText } from "./RenderedText";
import { Buckets, ContentRenderer, RenderEntry, RenderOptions } from "./types";

interface RenderedContentProps {
  id: string;
  entry: RenderEntry;
  references?: MarkdownReference[];
  renderOptions?: RenderOptions;
  renderObject?: (value: Record<string, unknown>) => ReactNode;
}

interface WebSearchResult {
  url: string;
  summary?: string | null;
}

interface WebSearchValue {
  query?: string | null;
  results: WebSearchResult[];
}

// The Model, Html and web_search renderers are selected by a property or
// entry name on plain objects, and those objects can come straight from an
// eval log (sample metadata, store, score values). Each guard checks the
// exact shape its renderer emits so any other object falls through to the
// generic record renderer instead of throwing mid-render.
const isModelValue = (v: unknown): v is { _model: string | number } =>
  isRecord(v) && (typeof v._model === "string" || typeof v._model === "number");

// Optional fields arrive as `null` from pydantic, not as missing keys.
const isOptionalString = (v: unknown): v is string | null | undefined =>
  v == null || typeof v === "string";

const isWebSearchResult = (v: unknown): v is WebSearchResult =>
  isRecord(v) && typeof v.url === "string" && isOptionalString(v.summary);

const isWebSearchValue = (v: unknown): v is WebSearchValue =>
  isRecord(v) &&
  isOptionalString(v.query) &&
  Array.isArray(v.results) &&
  v.results.every(isWebSearchResult);

/**
 * Renders content based on its type using registered content renderers.
 */
export const RenderedContent: FC<RenderedContentProps> = ({
  id,
  entry,
  references,
  renderOptions = { renderString: "markdown" },
  renderObject,
}): JSX.Element => {
  if (entry.value === null) {
    return (
      <span>
        <pre>
          <code>[null]</code>
        </pre>
      </span>
    );
  }
  const rendered = renderEntry(
    contentRenderers(renderObject),
    id,
    entry,
    renderOptions,
    references
  );
  if (isValidElement(rendered)) {
    return rendered;
  }

  return (
    <span>
      <ContentText text={fallbackText(entry.value)} />
    </span>
  );
};

const fallbackText = (value: unknown): string => {
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "function":
      return String(value).trim();
    default:
      try {
        return JSON.stringify(value);
      } catch {
        return "[Unable to display value]";
      }
  }
};

/**
 * The first renderer, in bucket order, that claims the entry decides it; its
 * output is returned even when it isn't an element.
 */
const renderEntry = (
  renderers: ContentRenderer[],
  id: string,
  entry: RenderEntry,
  options: RenderOptions,
  references: MarkdownReference[] | undefined
): ReactNode => {
  for (const renderer of renderers) {
    const result = renderer.render(id, entry, options, references);
    if (result) return result.rendered;
  }
  return undefined;
};

const renderString = (
  text: string,
  options: RenderOptions,
  references?: MarkdownReference[]
): ReactNode => {
  const trimmed = text.trim();
  if (options.renderString === "markdown") {
    return (
      <RenderedText
        markdown={trimmed}
        references={references}
        options={{ previewRefsOnHover: options.previewRefsOnHover }}
      />
    );
  }
  return (
    <pre className={clsx(styles.preWrap, styles.preCompact)}>
      <ContentText text={trimmed} />
    </pre>
  );
};

/**
 * The content renderers, sorted by bucket. Each returns undefined for an
 * entry that isn't its kind.
 */
const contentRenderers = (
  renderObject?: (value: Record<string, unknown>) => ReactNode
): ContentRenderer[] => {
  const renderers: ContentRenderer[] = [
    {
      bucket: Buckets.first,
      render: (_id, { value }) =>
        typeof value === "string" && value.includes("\u001b")
          ? { rendered: <ANSIDisplay output={value} /> }
          : undefined,
    },
    {
      bucket: Buckets.first,
      render: (_id, { value }) => {
        if (typeof value !== "string" || !isJson(value.trim())) {
          return undefined;
        }
        const obj: unknown = JSON5.parse(value);
        return { rendered: <JSONPanel data={isRecord(obj) ? obj : {}} /> };
      },
    },
    {
      bucket: Buckets.intermediate,
      render: (_id, { value }) =>
        isModelValue(value)
          ? {
              rendered: (
                <Fragment>
                  <Icon name="model" /> {value._model}
                </Fragment>
              ),
            }
          : undefined,
    },
    {
      bucket: Buckets.intermediate,
      render: (_id, { value }, options) =>
        typeof value === "boolean"
          ? { rendered: renderString(value.toString(), options) }
          : undefined,
    },
    {
      bucket: Buckets.intermediate,
      render: (_id, { value }, options) =>
        typeof value === "number"
          ? { rendered: renderString(formatNumber(value), options) }
          : undefined,
    },
    {
      bucket: Buckets.final,
      render: (_id, { value }, options, references) =>
        typeof value === "string"
          ? { rendered: renderString(value, options, references) }
          : undefined,
    },
    {
      bucket: Buckets.intermediate,
      render: (id, { value }) => {
        if (!Array.isArray(value)) return undefined;
        const arrayMap: Record<string, unknown> = {};
        value.forEach((e: unknown, index) => {
          arrayMap[`[${index}]`] = e;
        });
        return {
          rendered: renderObject ? (
            renderObject(arrayMap)
          ) : (
            <MetaDataGrid
              id={id}
              className={"font-size-small"}
              entries={arrayMap}
              options={{ plain: true }}
            />
          ),
        };
      },
    },
    {
      bucket: Buckets.intermediate,
      render: (_id, { name, value }) => {
        if (name !== "web_search" || !isWebSearchValue(value)) {
          return undefined;
        }
        const results: ReactNode[] = [];
        results.push(
          <div key="query" className={styles.query}>
            <Icon name="search" /> <ContentText text={value.query ?? ""} />
          </div>
        );
        value.results.forEach((result, index) => {
          results.push(
            <div key={`url-${index}`}>
              <ExternalLink href={result.url}>{result.url}</ExternalLink>
            </div>
          );
          results.push(
            <div
              key={`summary-${index}`}
              className={clsx("text-size-smaller", styles.summary)}
            >
              <ContentText text={result.summary ?? ""} />
            </div>
          );
        });
        // The caller keeps only a valid element; a bare array falls through
        // to the JSON fallback.
        return { rendered: <Fragment>{results}</Fragment> };
      },
    },
    {
      bucket: Buckets.intermediate,
      render: (_id, { name, value }) =>
        typeof value === "string" && name.startsWith("web_browser")
          ? {
              rendered: (
                <pre className={styles.preWrap}>
                  <ContentText text={value} />
                </pre>
              ),
            }
          : undefined,
    },
    {
      bucket: Buckets.intermediate,
      render: (_id, { value }) =>
        isHtmlEscape(value) ? { rendered: value._html } : undefined,
    },
    {
      bucket: Buckets.intermediate,
      render: (_id, { value }) =>
        typeof value === "string" && isRenderableImageSource(value)
          ? {
              rendered: (
                <RequireMedia kind="image">
                  <img src={value} alt="Attachment" />
                </RequireMedia>
              ),
            }
          : undefined,
    },
    {
      bucket: Buckets.intermediate,
      render: (id, { value }) => {
        if (!isRecord(value)) return undefined;
        return {
          rendered: renderObject ? (
            renderObject(value)
          ) : (
            <MetaDataGrid
              id={id}
              className={"font-size-small"}
              entries={value}
              options={{ plain: true }}
            />
          ),
        };
      },
    },
  ];
  return renderers.sort((a, b) => a.bucket - b.bucket);
};
