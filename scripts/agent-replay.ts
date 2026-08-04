import process from "node:process";

import {
  assertLoopbackUrl,
  extractAuthoritativeReplayPacket,
  formatAuthoritativeReplayPacket,
  validateReplayPacketSelector,
} from "../src/lib/agentReplay";

const getArg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
};

const requirePacketUrl = (): URL => {
  const value = getArg("--packet-url") ?? process.env.AGENT_REPLAY_PACKET_URL;
  if (!value) {
    throw new Error("Provide --packet-url or AGENT_REPLAY_PACKET_URL");
  }
  return assertLoopbackUrl(value);
};

const buildHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const accessToken = process.env.EDGE_REPLAY_ACCESS_TOKEN?.trim();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
};

const main = async (): Promise<void> => {
  const packetUrl = requirePacketUrl();
  const selector = validateReplayPacketSelector({
    correlationId: getArg("--correlation-id"),
    requestId: getArg("--request-id"),
    agentOperationId: getArg("--agent-operation-id"),
  });

  const response = await fetch(packetUrl, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ mode: "replay", ...selector }),
  });

  if (!response.ok) {
    throw new Error(`Replay packet request failed (${response.status})`);
  }

  const payload = await response.json();
  const packet = extractAuthoritativeReplayPacket(payload);

  process.stdout.write(`${formatAuthoritativeReplayPacket(packet)}\n`);
};

main().catch((error) => {
  console.error(
    "[replay] FAIL",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
