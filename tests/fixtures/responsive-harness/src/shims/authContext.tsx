import type { PropsWithChildren } from "react";

import { HARNESS_ORG_ID } from "../harness-data";

const harnessSession = {
  access_token: "responsive-harness-access-token",
  user: {
    id: "responsive-harness-user",
    email: "user.synthetic@example.test",
  },
};

export const useAuth = () => ({
  session: harnessSession,
  user: harnessSession.user,
  effectiveRole: "midtier",
  hasCapability: () => true,
  hasExactRole: (role: string) => role === "midtier",
  profile: {
    id: "responsive-harness-user",
    organization_id: HARNESS_ORG_ID,
    role: "midtier",
  },
});

export const AuthProvider = ({ children }: PropsWithChildren) => children;
