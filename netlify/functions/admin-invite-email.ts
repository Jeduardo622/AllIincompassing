import nodemailer from "nodemailer";
import { adminInviteEmailHandler, type AdminInviteEmailConfig } from "../../src/server/api/admin-invite-email";

declare const Netlify: {
  env: { get(name: string): string | undefined };
};

const readConfig = (): AdminInviteEmailConfig => {
  const port = Number(Netlify.env.get("ADMIN_INVITE_SMTP_PORT")?.trim() ?? "");
  const secureValue = Netlify.env.get("ADMIN_INVITE_SMTP_SECURE")?.trim().toLowerCase();
  return {
    deliverySecret: Netlify.env.get("ADMIN_INVITE_DELIVERY_SECRET") ?? "",
    smtpHost: Netlify.env.get("ADMIN_INVITE_SMTP_HOST") ?? "",
    smtpPort: port,
    smtpSecure: secureValue === "true" || (secureValue !== "false" && port === 465),
    smtpUsername: Netlify.env.get("ADMIN_INVITE_SMTP_USERNAME") ?? "",
    smtpPassword: Netlify.env.get("ADMIN_INVITE_SMTP_PASSWORD") ?? "",
    smtpFrom: Netlify.env.get("ADMIN_INVITE_SMTP_FROM") ?? "",
  };
};

export default async (request: Request) => adminInviteEmailHandler(request, {
  config: readConfig(),
  createTransport: (options) => nodemailer.createTransport(options),
});

export const config = {
  path: "/.netlify/functions/admin-invite-email",
};
