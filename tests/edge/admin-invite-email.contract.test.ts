import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { AdminInviteEmailConfig } from '../../src/server/api/admin-invite-email';

const sendMail = vi.fn();
const verifyTransport = vi.fn();
const createTransport = vi.fn(() => ({
  verify: verifyTransport,
  sendMail,
}));

vi.mock('nodemailer', () => ({
  default: { createTransport },
  createTransport,
}));

const basePayload = {
  template: 'admin-invite',
  to: 'bt.staff@example.com',
  variables: {
    invite_url: 'https://app.allincompassing.ai/accept-invite?token=test-token',
    expires_at: '2026-08-03T12:00:00.000Z',
    organization_id: '5238e88b-6198-4862-80a2-dbe15bbeabdd',
    role: 'bt',
  },
};

const signPayload = (secret: string, timestamp: string, body: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

describe('admin invite email adapter', () => {
  const config: AdminInviteEmailConfig = {
    deliverySecret: 'shared-delivery-secret',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecure: false,
    smtpUsername: 'smtp-user',
    smtpPassword: 'smtp-password',
    smtpFrom: 'All In Compassing <no-reply@example.com>',
  };

  const callHandler = async (
    request: Request,
    overrides: Partial<AdminInviteEmailConfig> = {},
  ) => {
    const { adminInviteEmailHandler } = await import('../../src/server/api/admin-invite-email');
    return adminInviteEmailHandler(request, {
      config: { ...config, ...overrides },
      createTransport,
    });
  };

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    sendMail.mockReset();
    verifyTransport.mockReset();
    createTransport.mockClear();
    verifyTransport.mockResolvedValue(true);
    sendMail.mockResolvedValue({ messageId: 'invite-message-id' });
  });

  it('accepts a signed request and sends the invite email through SMTP', async () => {
    const body = JSON.stringify(basePayload);
    const timestamp = new Date().toISOString();
    const signature = signPayload('shared-delivery-secret', timestamp, body);

    const response = await callHandler(new Request('https://example.com/.netlify/functions/admin-invite-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-invite-timestamp': timestamp,
        'x-invite-signature': signature,
      },
      body,
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 15_000,
      auth: {
        user: 'smtp-user',
        pass: 'smtp-password',
      },
    }));
    expect(verifyTransport).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'All In Compassing <no-reply@example.com>',
      to: 'bt.staff@example.com',
      subject: expect.stringContaining('Invitation'),
      text: expect.stringContaining(basePayload.variables.invite_url),
      html: expect.stringContaining(basePayload.variables.invite_url),
    }));
  });

  it('rejects requests with stale timestamps before SMTP side effects', async () => {
    const body = JSON.stringify(basePayload);
    const timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const signature = signPayload('shared-delivery-secret', timestamp, body);

    const response = await callHandler(new Request('https://example.com/.netlify/functions/admin-invite-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-invite-timestamp': timestamp,
        'x-invite-signature': signature,
      },
      body,
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'stale_signature' });
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects requests with invalid signatures before SMTP side effects', async () => {
    const body = JSON.stringify(basePayload);
    const timestamp = new Date().toISOString();

    const response = await callHandler(new Request('https://example.com/.netlify/functions/admin-invite-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-invite-timestamp': timestamp,
        'x-invite-signature': 'invalid-signature',
      },
      body,
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_signature' });
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects unsupported templates before SMTP side effects', async () => {
    const body = JSON.stringify({ ...basePayload, template: 'password-reset' });
    const timestamp = new Date().toISOString();
    const signature = signPayload('shared-delivery-secret', timestamp, body);

    const response = await callHandler(new Request('https://example.com/.netlify/functions/admin-invite-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-invite-timestamp': timestamp,
        'x-invite-signature': signature,
      },
      body,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_payload' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('fails closed before SMTP side effects when configuration is incomplete', async () => {
    const body = JSON.stringify(basePayload);
    const timestamp = new Date().toISOString();
    const signature = signPayload('shared-delivery-secret', timestamp, body);

    const response = await callHandler(new Request('https://example.com/.netlify/functions/admin-invite-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-invite-timestamp': timestamp,
        'x-invite-signature': signature,
      },
      body,
    }), { smtpPassword: '' });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: 'email_adapter_unconfigured' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('does not expose missing signing configuration to unauthenticated callers', async () => {
    const body = JSON.stringify(basePayload);
    const timestamp = new Date().toISOString();

    const response = await callHandler(new Request('https://example.com/.netlify/functions/admin-invite-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-invite-timestamp': timestamp,
        'x-invite-signature': signPayload('', timestamp, body),
      },
      body,
    }), { deliverySecret: '' });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_signature' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('returns a provider failure without leaking provider details', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp-password secret-token'));
    const body = JSON.stringify(basePayload);
    const timestamp = new Date().toISOString();
    const signature = signPayload('shared-delivery-secret', timestamp, body);

    const response = await callHandler(new Request('https://example.com/.netlify/functions/admin-invite-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-invite-timestamp': timestamp,
        'x-invite-signature': signature,
      },
      body,
    }));

    expect(response.status).toBe(502);
    await expect(response.text()).resolves.not.toMatch(/smtp-password|secret-token/i);
  });

  it('uses secure SMTP automatically for port 465 through the netlify wrapper', async () => {
    vi.stubGlobal('Netlify', {
      env: {
        get: (name: string) => ({
          ADMIN_INVITE_DELIVERY_SECRET: 'shared-delivery-secret',
          ADMIN_INVITE_SMTP_HOST: 'smtp.example.com',
          ADMIN_INVITE_SMTP_PORT: '465',
          ADMIN_INVITE_SMTP_USERNAME: 'smtp-user',
          ADMIN_INVITE_SMTP_PASSWORD: 'smtp-password',
          ADMIN_INVITE_SMTP_FROM: 'All In Compassing <no-reply@example.com>',
        } satisfies Record<string, string>)[name],
      },
    });
    const netlifyModule = await import('../../netlify/functions/admin-invite-email');
    const body = JSON.stringify(basePayload);
    const timestamp = new Date().toISOString();
    const signature = signPayload('shared-delivery-secret', timestamp, body);

    const response = await netlifyModule.default(new Request('https://example.com/.netlify/functions/admin-invite-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-invite-timestamp': timestamp,
        'x-invite-signature': signature,
      },
      body,
    }));

    expect(response.status).toBe(202);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      port: 465,
      secure: true,
    }));
  });
});
