export type AgentRole = "client" | "therapist" | "admin" | "bcba" | "super_admin";

const STAFF_ROLE_PRECEDENCE: readonly Exclude<AgentRole, "client">[] = [
  "super_admin",
  "bcba",
  "admin",
  "therapist",
];

export const resolveAgentRole = async (
  hasRole: (role: Exclude<AgentRole, "client">) => Promise<boolean>,
  onError: (error: unknown) => void = () => {},
): Promise<AgentRole> => {
  try {
    for (const role of STAFF_ROLE_PRECEDENCE) {
      if (await hasRole(role)) return role;
    }
  } catch (error) {
    onError(error);
  }
  return "client";
};
