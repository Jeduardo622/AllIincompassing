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
  loading: false,
  profileLoading: false,
  effectiveRole: "admin",
  hasCapability: () => true,
  hasExactRole: (role: string) => role === "admin",
  profile: {
    id: "responsive-harness-user",
    organization_id: HARNESS_ORG_ID,
    role: "admin",
  },
});

export const AuthProvider = ({ children }: PropsWithChildren) => children;
