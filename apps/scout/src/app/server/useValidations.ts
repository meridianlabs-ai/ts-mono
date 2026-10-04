import { skipToken, useMutation, useQueryClient } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";
import {
  CreateValidationSetRequest,
  ValidationCase,
  ValidationCaseRequest,
} from "../../types/api-types";

import {
  ValidationCaseParams,
  validationCaseQuery,
  validationCasesQuery,
  validationSetsQuery,
} from "./queries";

/**
 * Hook to fetch all validation set URIs in the project.
 */
export const useValidationSets = (): AsyncData<string[]> => {
  const api = useApi();
  return useAsyncDataFromQuery(validationSetsQuery(api));
};

/**
 * Hook to fetch validation cases for a specific validation set.
 */
export const useValidationCases = (
  uri: string | typeof skipToken
): AsyncData<ValidationCase[]> => {
  const api = useApi();
  return useAsyncDataFromQuery(validationCasesQuery(api, uri));
};

/**
 * Hook to fetch a single validation case by URI and case ID.
 * Returns null (not an error) when the case is not found (404).
 */
export const useValidationCase = (
  params: ValidationCaseParams | typeof skipToken
): AsyncData<ValidationCase | null> => {
  const api = useApi();
  return useAsyncDataFromQuery(validationCaseQuery(api, params));
};

type CasePredicate = NonNullable<ValidationCase["predicate"]>;

// Exhaustive by construction (see kInvalidationTopics in ./queries).
const kCasePredicates: Record<CasePredicate, true> = {
  gt: true,
  gte: true,
  lt: true,
  lte: true,
  eq: true,
  ne: true,
  contains: true,
  startswith: true,
  endswith: true,
  icontains: true,
  iequals: true,
};

const isCasePredicate = (value: string): value is CasePredicate =>
  Object.hasOwn(kCasePredicates, value);

// The request body is looser than the stored case (`id` and `predicate` are
// free-form until the server validates them), so an optimistic cache entry
// keeps the case's identity and only adopts a predicate it can vouch for.
const optimisticCase = (
  previous: ValidationCase,
  data: ValidationCaseRequest
): ValidationCase => {
  const { id: _id, predicate, ...rest } = data;
  return {
    ...previous,
    ...rest,
    predicate:
      predicate == null
        ? predicate
        : isCasePredicate(predicate)
          ? predicate
          : previous.predicate,
  };
};

/**
 * Hook to create a new validation set.
 */
export const useCreateValidationSet = () => {
  const queryClient = useQueryClient();
  const api = useApi();
  return useMutation<
    string,
    Error,
    CreateValidationSetRequest,
    { previous: string[] | undefined }
  >({
    mutationFn: (request) => api.createValidationSet(request),

    onMutate: async (request) => {
      const { queryKey } = validationSetsQuery(api);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      if (previous) {
        queryClient.setQueryData(queryKey, [...previous, request.path]);
      }
      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          validationSetsQuery(api).queryKey,
          context.previous
        );
      }
    },

    onSuccess: () => {
      // Background reconciliation after the optimistic append.
      queryClient
        .invalidateQueries({ queryKey: validationSetsQuery(api).queryKey })
        .catch(console.error);
    },
  });
};

/**
 * Hook to update a validation case (upsert).
 * Uses optimistic updates to prevent UI flicker during save.
 */
export const useUpdateValidationCase = (uri: string) => {
  const queryClient = useQueryClient();
  const api = useApi();
  return useMutation<
    ValidationCase,
    Error,
    { caseId: string; data: ValidationCaseRequest },
    {
      previousCase: ValidationCase | null | undefined;
      previousCases: ValidationCase[] | undefined;
    }
  >({
    mutationFn: ({ caseId, data }) =>
      api.upsertValidationCase(uri, caseId, data),

    onMutate: async ({ caseId, data }) => {
      const caseKey = validationCaseQuery(api, { url: uri, caseId }).queryKey;
      const casesKey = validationCasesQuery(api, uri).queryKey;

      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await Promise.all([
        queryClient.cancelQueries({ queryKey: caseKey }),
        queryClient.cancelQueries({ queryKey: casesKey }),
      ]);

      // Snapshot the previous values for rollback
      const previousCase = queryClient.getQueryData(caseKey);
      const previousCases = queryClient.getQueryData(casesKey);

      // Optimistically update both caches
      if (previousCase) {
        queryClient.setQueryData(caseKey, optimisticCase(previousCase, data));
      }
      if (previousCases) {
        queryClient.setQueryData(
          casesKey,
          previousCases.map((c) =>
            c.id === caseId ? optimisticCase(c, data) : c
          )
        );
      }

      return { previousCase, previousCases };
    },

    onError: (_err, { caseId }, context) => {
      // Rollback to previous values on error
      if (context?.previousCase) {
        queryClient.setQueryData(
          validationCaseQuery(api, { url: uri, caseId }).queryKey,
          context.previousCase
        );
      }
      if (context?.previousCases) {
        queryClient.setQueryData(
          validationCasesQuery(api, uri).queryKey,
          context.previousCases
        );
      }
    },

    onSuccess: (_data, { caseId }) => {
      // Both caches already hold the optimistic value, so these refetch in
      // the background without flicker.
      queryClient
        .invalidateQueries({
          queryKey: validationCaseQuery(api, { url: uri, caseId }).queryKey,
        })
        .catch(console.error);
      queryClient
        .invalidateQueries({
          queryKey: validationCasesQuery(api, uri).queryKey,
        })
        .catch(console.error);
    },
  });
};

/**
 * Hook to delete a single validation case.
 */
export const useDeleteValidationCase = (uri: string) => {
  const queryClient = useQueryClient();
  const api = useApi();
  return useMutation<void, Error, string>({
    mutationFn: (caseId) => api.deleteValidationCase(uri, caseId),
    // Not optimistic: stay pending until the refetch lands so the deleted
    // row can't linger after the spinner stops.
    onSuccess: async (_data, caseId) => {
      // The server just confirmed there is no case: write that truth rather
      // than refetching a 404 (see validationCaseQuery), so an open editor
      // drops straight to the empty state.
      queryClient.setQueryData(
        validationCaseQuery(api, { url: uri, caseId }).queryKey,
        null
      );
      await queryClient.invalidateQueries({
        queryKey: validationCasesQuery(api, uri).queryKey,
      });
    },
  });
};

/**
 * Hook to delete multiple validation cases (bulk delete).
 * Uses Promise.allSettled to handle partial failures gracefully.
 */
export const useBulkDeleteValidationCases = (uri: string) => {
  const queryClient = useQueryClient();
  const api = useApi();
  return useMutation<{ succeeded: number; failed: number }, Error, string[]>({
    mutationFn: async (caseIds) => {
      const results = await Promise.allSettled(
        caseIds.map((id) => api.deleteValidationCase(uri, id))
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      // Throw if all failed
      if (failed === results.length) {
        const errors = results
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => String(r.reason));
        throw new Error(`All deletions failed: ${errors.join(", ")}`);
      }

      return { succeeded, failed };
    },
    // Reached only when at least one deletion succeeded (all-failed throws).
    // Not optimistic: stay pending until the refetch lands so deleted rows
    // can't linger after the spinner stops.
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: validationCasesQuery(api, uri).queryKey,
      });
    },
  });
};

export type CopyValidationCasesRequest = {
  /** Validation set the cases are written into. */
  destUri: string;
  cases: { caseId: string; data: ValidationCaseRequest }[];
};

/**
 * Hook to copy validation cases into another validation set (bulk upsert).
 * Uses Promise.allSettled to handle partial failures gracefully; the result
 * reports how many copies landed so callers can warn without aborting.
 */
export const useCopyValidationCases = () => {
  const queryClient = useQueryClient();
  const api = useApi();
  return useMutation<
    { succeeded: number; failed: number },
    Error,
    CopyValidationCasesRequest
  >({
    mutationFn: async ({ destUri, cases }) => {
      const results = await Promise.allSettled(
        cases.map(({ caseId, data }) =>
          api.upsertValidationCase(destUri, caseId, data)
        )
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      // Throw if all failed
      if (failed === results.length) {
        const errors = results
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => String(r.reason));
        throw new Error(
          `All ${failed} copy operations failed: ${errors.join(", ")}`
        );
      }

      return { succeeded, failed };
    },
    // Reached only when at least one copy succeeded (all-failed throws).
    // Not optimistic: stay pending until the destination refetch lands so a
    // move can't show the source rows gone before the copies appear.
    onSuccess: async (_data, { destUri, cases }) => {
      // Copied cases may already be cached as "missing" for the destination
      // set (the editor caches 404s as null), so those entries go stale too.
      for (const { caseId } of cases) {
        queryClient
          .invalidateQueries({
            queryKey: validationCaseQuery(api, { url: destUri, caseId })
              .queryKey,
          })
          .catch(console.error);
      }
      await queryClient.invalidateQueries({
        queryKey: validationCasesQuery(api, destUri).queryKey,
      });
    },
  });
};

/**
 * Hook to delete an entire validation set.
 */
export const useDeleteValidationSet = () => {
  const queryClient = useQueryClient();
  const api = useApi();
  return useMutation<void, Error, string>({
    mutationFn: (uri) => api.deleteValidationSet(uri),
    // Not optimistic: stay pending until the refetch lands so the deleted
    // set can't linger after the spinner stops.
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: validationSetsQuery(api).queryKey,
      });
    },
  });
};

/**
 * Hook to rename a validation set.
 */
export const useRenameValidationSet = () => {
  const queryClient = useQueryClient();
  const api = useApi();
  return useMutation<string, Error, { uri: string; newName: string }>({
    mutationFn: ({ uri, newName }) => api.renameValidationSet(uri, newName),
    // Not optimistic: stay pending until the refetch lands so the old name
    // can't linger after the spinner stops.
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: validationSetsQuery(api).queryKey,
      });
    },
  });
};
