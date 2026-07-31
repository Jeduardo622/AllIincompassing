import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const MAX_REQUEST_BYTES = 16_384;
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

const InvitePayloadSchema = z.object({
  template: z.literal("admin-invite"),
  to: z.string().trim().email(),
  variables: z.object({
    invite_url: z.string().url().refine((value) => new URL(value).protocol === "https:"),
    expires_at: z.string().datetime({ offset: true }),
    organization_id: z.string().uuid(),
    role: z.enum(["bt", "therapist", "midtier", "admin_schedule", "admin", "bcba", "super_admin"]),
  }).strict(),
}).strict();

export interface AdminInviteEmailConfig {
  deliverySecret: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
  smtpFrom: string;
}

interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  auth: { user: string; pass: string };
}

interface AdminInviteEmailDependencies {
  config: AdminInviteEmailConfig;
  createTransport(options: SmtpTransportOptions): MailTransport;
  now?: () => number;
}

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

const hasCompleteConfig = (config: AdminInviteEmailConfig) =>
  config.deliverySecret.trim().length >= 16
  && config.smtpHost.trim().length > 0
  && Number.isInteger(config.smtpPort)
  && config.smtpPort > 0
  && config.smtpPort <= 65_535
  && config.smtpUsername.trim().length > 0
  && config.smtpPassword.length > 0
  && config.smtpFrom.trim().length > 0;

const signaturesMatch = (
  secret: string,
  timestamp: string,
  body: string,
  suppliedSignature: string,
) => {
  if (!/^[a-f0-9]{64}$/i.test(suppliedSignature)) return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"),
    "hex",
  );
  const supplied = Buffer.from(suppliedSignature, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
};

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
})[character] ?? character);

export const adminInviteEmailHandler = async (
  request: Request,
  dependencies: AdminInviteEmailDependencies,
) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const { config } = dependencies;
  if (config.deliverySecret.trim().length < 16) {
    return jsonResponse(401, { error: "invalid_signature" });
  }

  const timestamp = request.headers.get("x-invite-timestamp")?.trim() ?? "";
  const suppliedSignature = request.headers.get("x-invite-signature")?.trim() ?? "";
  const signedAt = Date.parse(timestamp);
  const now = dependencies.now?.() ?? Date.now();
  if (!Number.isFinite(signedAt) || Math.abs(now - signedAt) > MAX_SIGNATURE_AGE_MS) {
    return jsonResponse(401, { error: "stale_signature" });
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
    return jsonResponse(413, { error: "payload_too_large" });
  }

  if (!signaturesMatch(config.deliverySecret, timestamp, body, suppliedSignature)) {
    return jsonResponse(401, { error: "invalid_signature" });
  }

  if (!hasCompleteConfig(config)) {
    return jsonResponse(500, { error: "email_adapter_unconfigured" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body || "null");
  } catch {
    return jsonResponse(400, { error: "invalid_payload" });
  }
  const parsed = InvitePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse(400, { error: "invalid_payload" });
  }

  const { to, variables } = parsed.data;
  const roleLabel = variables.role.replaceAll("_", " ");
  const subject = "Invitation to All In Compassing";
  const text = [
    `You have been invited to All In Compassing as ${roleLabel}.`,
    `Accept your invite: ${variables.invite_url}`,
    `This link expires at ${variables.expires_at}.`,
  ].join("\n\n");
  const html = [
    `<p>You have been invited to All In Compassing as ${escapeHtml(roleLabel)}.</p>`,
    `<p><a href="${escapeHtml(variables.invite_url)}">Accept your invite</a></p>`,
    `<p>This link expires at ${escapeHtml(variables.expires_at)}.</p>`,
  ].join("");

  try {
    const transport = dependencies.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      requireTLS: !config.smtpSecure,
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 15_000,
      auth: {
        user: config.smtpUsername,
        pass: config.smtpPassword,
      },
    });
    await transport.sendMail({
      from: config.smtpFrom,
      to,
      subject,
      text,
      html,
    });
    return jsonResponse(202, { ok: true });
  } catch {
    console.error("Admin invite SMTP delivery failed", { code: "admin_invite_smtp_failed" });
    return jsonResponse(502, { error: "email_delivery_failed" });
  }
};
