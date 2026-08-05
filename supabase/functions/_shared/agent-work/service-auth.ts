export type AgentWorkGatewayEnvironment = {
  SUPABASE_PUBLISHABLE_KEYS?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
};

export function resolveAgentWorkGatewayApiKeys(
  env: AgentWorkGatewayEnvironment,
): string[] {
  const keys = new Set<string>();
  const configured = env.SUPABASE_PUBLISHABLE_KEYS?.trim();
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as Record<string, unknown>;
      Object.values(parsed).forEach((value) => {
        if (typeof value === "string" && value.trim()) keys.add(value.trim());
      });
    } catch {
      return [];
    }
  }
  for (const value of [env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_ANON_KEY]) {
    const normalized = value?.trim();
    if (normalized) keys.add(normalized);
  }
  return [...keys];
}

export function isAgentWorkServiceRequestAuthorized(
  request: Request,
  invocationSecretHeader: string,
  invocationSecret: string,
  gatewayApiKeys: string[],
): boolean {
  const providedApiKey = request.headers.get("apikey")?.trim() ?? "";
  const providedSecret = request.headers.get(invocationSecretHeader) ?? "";
  const configuredApiKeys = gatewayApiKeys.map((value) => value.trim()).filter(
    Boolean,
  );
  if (
    !providedApiKey || !providedSecret || !invocationSecret ||
    configuredApiKeys.length === 0
  ) {
    return false;
  }
  return configuredApiKeys.some((value) =>
    constantTimeEqual(value, providedApiKey)
  ) && constantTimeEqual(invocationSecret, providedSecret);
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length, 1);
  const paddedLeft = new Uint8Array(length);
  const paddedRight = new Uint8Array(length);
  paddedLeft.set(leftBytes);
  paddedRight.set(rightBytes);

  let diff = 0;
  for (let index = 0; index < length; index += 1) {
    diff |= paddedLeft[index] ^ paddedRight[index];
  }
  return diff === 0 && leftBytes.length === rightBytes.length;
}
