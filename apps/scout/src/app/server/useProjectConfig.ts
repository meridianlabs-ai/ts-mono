import {
  DefaultError,
  useMutation,
  UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";
import { ProjectConfig, ProjectConfigInput } from "../../types/api-types";

import { appConfigQuery, projectConfigQuery } from "./queries";

export type ProjectConfigWithEtag = {
  config: ProjectConfig;
  etag: string;
};

/**
 * Loads project configuration from scout.yaml, with the etag that
 * `useUpdateProjectConfig` needs for optimistic concurrency control.
 */
export const useProjectConfig = (): AsyncData<ProjectConfigWithEtag> => {
  const api = useApi();
  return useAsyncDataFromQuery(projectConfigQuery(api));
};

/**
 * Mutation hook for updating project configuration.
 *
 * Updates scout.yaml while preserving comments and formatting.
 * Requires the current etag for optimistic concurrency control.
 *
 * On success, updates the query cache with the new config and etag.
 * On 412 Precondition Failed, the config was modified externally.
 */
export const useUpdateProjectConfig = (): UseMutationResult<
  ProjectConfigWithEtag,
  DefaultError,
  { config: ProjectConfigInput; etag: string | null }
> => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ config, etag }) => api.updateProjectConfig(config, etag),
    onSuccess: (data) => {
      queryClient.setQueryData(projectConfigQuery(api).queryKey, data);
      queryClient
        .invalidateQueries({ queryKey: appConfigQuery(api).queryKey })
        .catch(console.error);
    },
  });
};

/*
import { useProjectConfig, useUpdateProjectConfig } from "./server/useProjectConfig";                                
                                                                                                                      
function ConfigEditor() {                                                                                            
  const configData = useProjectConfig();                                                                             
  const mutation = useUpdateProjectConfig();                                                                         
                                                                                                                      
  if (configData.loading) return <Loading />;                                                                        
  if (configData.error) return <Error error={configData.error} />;                                                   
                                                                                                                      
  const { config, etag } = configData.data;                                                                          
                                                                                                                      
  const handleSave = async (newConfig: ProjectConfigInput) => {                                                      
    try {                                                                                                            
      await mutation.mutateAsync({ config: newConfig, etag });                                                       
    } catch (error) {                                                                                                
      if (error instanceof ApiError && error.status === 412) {                                                       
        // Config was modified externally - prompt user to refresh                                                   
      }                                                                                                              
    }                                                                                                                
  };                                                                                                                 
  return <Form config={config} onSave={handleSave} />;                                                               
}                             

*/
