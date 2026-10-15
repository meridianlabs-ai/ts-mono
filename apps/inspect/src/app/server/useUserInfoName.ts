import { skipToken, useQuery } from "@tanstack/react-query";

import { useAppConfig } from "../../app_config";

/**
 * The server's best-effort identity (git `user.name`, else the OS login),
 * used to prefill Author in the edit dialogs. Fetched on first enabled use
 * and kept for the session, since it doesn't change while the viewer runs.
 * Hosts without the endpoint, an empty name, and a failed request all give
 * `undefined`: the field stays blank and the user types a name.
 */
export const useUserInfoName = (enabled: boolean): string | undefined => {
  const { api } = useAppConfig();
  const getUserInfo = api.get_user_info;
  const { data } = useQuery({
    queryKey: ["user-info"],
    queryFn: enabled && getUserInfo ? () => getUserInfo() : skipToken,
    staleTime: Infinity,
    retry: false,
  });
  return data?.name || undefined;
};
