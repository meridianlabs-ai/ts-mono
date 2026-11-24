import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useAppConfig } from "../../app_config";
import { UserInfo } from "../../client/api/types";

/**
 * The server's best-effort identity (git `user.name`, else the OS login),
 * used to prefill Author in the edit dialogs. Fetched on first enabled use
 * and kept for the session, since it doesn't change while the viewer runs.
 * Hosts without the endpoint never fetch, so it stays loading. There, on a
 * failed request, or with an empty name, the field stays blank and the user
 * types a name.
 */
export const useUserInfo = (enabled: boolean): AsyncData<UserInfo> => {
  const { api } = useAppConfig();
  const getUserInfo = api.get_user_info;
  return useAsyncDataFromQuery({
    queryKey: ["user-info"],
    queryFn: enabled && getUserInfo ? () => getUserInfo() : skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
};
