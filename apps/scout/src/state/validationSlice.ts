import type { StoreSlice } from "./store";

export interface ValidationSlice {
  selectedValidationSetUri?: string;
  validationCaseSelection: Record<string, boolean>;
  validationSplitFilter?: string;
  validationSearchText?: string;

  // validationEditorState
  editorSelectedValidationSetUri?: string;

  setSelectedValidationSetUri: (uri: string | undefined) => void;
  setValidationCaseSelection: (selection: Record<string, boolean>) => void;
  toggleValidationCaseSelection: (caseId: string) => void;
  setValidationSplitFilter: (split: string | undefined) => void;
  setValidationSearchText: (text: string | undefined) => void;
  clearValidationState: () => void;

  setEditorSelectedValidationSetUri: (uri: string | undefined) => void;
}

export const createValidationSlice: StoreSlice<ValidationSlice> = (set) => ({
  validationCaseSelection: {},

  setSelectedValidationSetUri: (uri: string | undefined) => {
    set((state) => {
      state.selectedValidationSetUri = uri;
      // Clear case selection when switching validation sets
      state.validationCaseSelection = {};
    });
  },
  setValidationCaseSelection: (selection: Record<string, boolean>) => {
    set((state) => {
      state.validationCaseSelection = selection;
    });
  },
  toggleValidationCaseSelection: (caseId: string) => {
    set((state) => {
      const current = state.validationCaseSelection[caseId] ?? false;
      state.validationCaseSelection[caseId] = !current;
    });
  },
  setValidationSplitFilter: (split: string | undefined) => {
    set((state) => {
      state.validationSplitFilter = split;
    });
  },
  setValidationSearchText: (text: string | undefined) => {
    set((state) => {
      state.validationSearchText = text;
    });
  },
  clearValidationState: () => {
    set((state) => {
      state.selectedValidationSetUri = undefined;
      state.validationCaseSelection = {};
      state.validationSplitFilter = undefined;
      state.validationSearchText = undefined;
    });
  },
  setEditorSelectedValidationSetUri: (uri: string | undefined) => {
    set((state) => {
      state.editorSelectedValidationSetUri = uri;
    });
  },
});
