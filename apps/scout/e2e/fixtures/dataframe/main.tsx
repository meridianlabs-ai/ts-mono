import { from } from "arquero";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "@tsmono/theme/base";
import "@tsmono/theme/vscode";
import "../../../src/app/App.css";

import { ComponentIconProvider } from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { testIcons } from "@tsmono/react/testing";

import { apiScoutServer } from "../../../src/api/api-scout-server";
import { DataframeView } from "../../../src/app/components/DataframeView";
import { useDataframeData } from "../../../src/app/components/useDataframeData";
import { DataframeGridApiProvider } from "../../../src/app/scan/scanners/dataframe/DataframeGridApiContext";
import { ScannerDataframeClearFiltersButton } from "../../../src/app/scan/scanners/dataframe/ScannerDataframeClearFiltersButton";
import {
  ScannerDataframeCopyCSVButton,
  ScannerDataframeDownloadCSVButton,
} from "../../../src/app/scan/scanners/dataframe/ScannerDataframeCSVButtons";
import { scoutStateHooks } from "../../../src/state/componentStateAdapter";
import { createStore, StoreProvider, useStore } from "../../../src/state/store";

const columns = ["transcript_id", "value", "explanation", "metadata", "passed"];
const params = new URLSearchParams(location.search);
document.documentElement.dataset.bsTheme = params.get("theme") ?? "light";
const rowCount = Number(params.get("rows") ?? 6);
const data = from(
  Array.from({ length: rowCount }, (_, index) => ({
    identifier: `result-${index}`,
    transcript_id: `transcript-${index.toString().padStart(4, "0")}`,
    value: [10, 2, null, -4, 2, 100][index % 6],
    explanation: [
      'Alpha, quoted "text"\nnext line',
      "beta",
      "",
      "ALPHA",
      null,
      "Long explanation ".repeat(100),
    ][index % 6],
    metadata: { index, tags: ["a", "b"] },
    passed: index % 2 === 0,
  }))
);
// localStorage stands in for VS Code webview state across page recreation.
// The browser app itself uses NoPersistence for this store.
const store = createStore({ ...apiScoutServer(), storage: localStorage });
store.setState({
  dataframeFilterColumns: columns,
  selectedScanner: "regression/scanner",
});

function Fixture() {
  const wrap = useStore((state) => state.dataframeWrapText ?? false);
  const setWrap = useStore((state) => state.setDataframeWrapText);
  const dataframe = useDataframeData(data);
  const [opened, setOpened] = useState("");

  const [mounted, setMounted] = useState(true);
  return (
    <>
      <ComponentIconProvider icons={testIcons}>
        <ComponentStateProvider hooks={scoutStateHooks}>
          <DataframeGridApiProvider>
            <div style={{ display: "flex", gap: 12, padding: 8 }}>
              <ScannerDataframeCopyCSVButton />
              <ScannerDataframeDownloadCSVButton />
              <ScannerDataframeClearFiltersButton />
              <button onClick={() => setWrap(!wrap)}>Wrap Text</button>
              <button
                onClick={() =>
                  store.setState({
                    dataframeFilterColumns:
                      dataframe.columnNames.length === columns.length
                        ? columns.slice(0, 3)
                        : columns,
                  })
                }
              >
                Toggle columns
              </button>
              <button onClick={() => setMounted(!mounted)}>Toggle grid</button>
              <input aria-label="Unrelated input" />
            </div>
            <div style={{ height: 500, width: "100%" }}>
              {mounted && (
                <DataframeView
                  dataframe={dataframe}
                  wrapText={wrap}
                  onRowDoubleClicked={(row) => {
                    if ("identifier" in row) setOpened(String(row.identifier));
                  }}
                />
              )}
            </div>
            <output aria-label="Visible rows">{dataframe.rows.length}</output>
            <output aria-label="Opened result">{opened}</output>
          </DataframeGridApiProvider>
        </ComponentStateProvider>
      </ComponentIconProvider>
    </>
  );
}

const root = document.getElementById("app");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <StrictMode>
    <StoreProvider value={store}>
      <Fixture />
    </StoreProvider>
  </StrictMode>
);
