/* eslint-disable no-console */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const DEFAULT_URL = 'https://app.allincompassing.ai/api/runtime-config';

const performRequest = (urlString) =>
  new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const handler = url.protocol === 'http:' ? httpRequest : httpsRequest;

    const req = handler(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            statusMessage: res.statusMessage ?? '',
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.on('error', reject);
    req.end();
  });

const run = async () => {
  const url = process.env.RUNTIME_CONFIG_URL ?? DEFAULT_URL;
  console.log(`Verifying runtime config endpoint → ${url}`);

  const response = await performRequest(url);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Runtime config endpoint returned ${response.statusCode} ${response.statusMessage ?? ''}`.trim());
  }

  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch (error) {
    throw new Error(`Runtime config endpoint returned non-JSON payload: ${error.message ?? String(error)}`);
  }

  const missing = [];
  if (!payload.supabaseUrl || typeof payload.supabaseUrl !== 'string') missing.push('supabaseUrl');
  if (!payload.supabaseAnonKey || typeof payload.supabaseAnonKey !== 'string') missing.push('supabaseAnonKey');
  if (!payload.defaultOrganizationId || typeof payload.defaultOrganizationId !== 'string') {
    missing.push('defaultOrganizationId');
  }

  if (missing.length > 0) {
    throw new Error(`Runtime config payload missing keys: ${missing.join(', ')}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        supabaseUrl: payload.supabaseUrl,
        defaultOrganizationId: payload.defaultOrganizationId,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: 'Runtime config contract failed',
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});


