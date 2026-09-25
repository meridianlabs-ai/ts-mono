import { FC, ReactNode } from "react";

import { ContentTrustProvider } from "../components/ContentTrust";

/** Test wrapper for components exercised on their trusted (rich) path. */
export const TrustedContentWrapper: FC<{ children: ReactNode }> = ({
  children,
}) => <ContentTrustProvider value="trusted">{children}</ContentTrustProvider>;
