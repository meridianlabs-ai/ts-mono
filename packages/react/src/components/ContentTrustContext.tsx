import { createContext, FC, ReactNode, useContext } from "react";

import {
  ContentRenderingPolicy,
  intersectContentPolicies,
  isRichContentPolicy,
  plainContentPolicy,
  richContentPolicy,
} from "./contentRenderingPolicy";

/**
 * Coarse trust from application or log configuration, mapped to rendering
 * permissions by the source and ceiling providers.
 */
export type ContentTrust = "trusted" | "untrusted";

// Untrusted by default: content outside any provider (a new view, a missing
// wrapper, a log whose trust isn't known yet) must fail safe.
const ContentPolicyContext = createContext(plainContentPolicy);

// The most trust any content below may have (e.g. a viewer-wide setting).
const ContentPolicyCeilingContext = createContext(richContentPolicy);

export const ContentPolicyProvider: FC<{
  value: ContentRenderingPolicy;
  children: ReactNode;
}> = ({ value, children }) => (
  <ContentPolicyContext.Provider value={value}>
    {children}
  </ContentPolicyContext.Provider>
);

export const ContentPolicyCeilingProvider: FC<{
  value: ContentRenderingPolicy;
  children: ReactNode;
}> = ({ value, children }) => {
  const parent = useContext(ContentPolicyCeilingContext);
  return (
    <ContentPolicyCeilingContext.Provider
      value={intersectContentPolicies(parent, value)}
    >
      {children}
    </ContentPolicyCeilingContext.Provider>
  );
};

export const useContentPolicy = (): ContentRenderingPolicy =>
  intersectContentPolicies(
    useContext(ContentPolicyCeilingContext),
    useContext(ContentPolicyContext)
  );

export const ContentTrustProvider: FC<{
  value: ContentTrust;
  children: ReactNode;
}> = ({ value, children }) => (
  <ContentPolicyProvider
    value={value === "trusted" ? richContentPolicy : plainContentPolicy}
  >
    {children}
  </ContentPolicyProvider>
);

/**
 * Caps the trust of everything below it, whatever the nearer
 * `ContentTrustProvider`s say. A nested ceiling can only lower it further.
 */
export const ContentTrustCeilingProvider: FC<{
  value: ContentTrust;
  children: ReactNode;
}> = ({ value, children }) => (
  <ContentPolicyCeilingProvider
    value={value === "trusted" ? richContentPolicy : plainContentPolicy}
  >
    {children}
  </ContentPolicyCeilingProvider>
);

/** Arbitrary render callbacks require every rendering permission. */
export const useHasAllContentPermissions = (): boolean =>
  isRichContentPolicy(useContentPolicy());
