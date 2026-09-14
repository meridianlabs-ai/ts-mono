import {
  createContext,
  FC,
  ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";

export interface DataframeGridApi {
  getDataAsCsv: (options: { columnKeys: string[] }) => string;
  exportDataAsCsv: (options: {
    fileName: string;
    columnKeys: string[];
  }) => void;
}

interface DataframeGridApiContextValue {
  gridApi: DataframeGridApi | null;
  setGridApi: (api: DataframeGridApi | null) => void;
}

const DataframeGridApiContext =
  createContext<DataframeGridApiContextValue | null>(null);

export const DataframeGridApiProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [gridApi, setGridApiState] = useState<DataframeGridApi | null>(null);

  const setGridApi = useCallback((api: DataframeGridApi | null) => {
    setGridApiState(api);
  }, []);

  return (
    <DataframeGridApiContext.Provider value={{ gridApi, setGridApi }}>
      {children}
    </DataframeGridApiContext.Provider>
  );
};

export const useDataframeGridApi = (): DataframeGridApi | null => {
  const context = useContext(DataframeGridApiContext);
  if (!context) {
    // Return null if not within provider - buttons will be disabled
    return null;
  }
  return context.gridApi;
};

export const useSetDataframeGridApi = (): ((
  api: DataframeGridApi | null
) => void) => {
  const context = useContext(DataframeGridApiContext);
  if (!context) {
    // Return no-op if not within provider
    return () => {};
  }
  return context.setGridApi;
};
