// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';

const validPacket = {
  schemaVersion: 'agent-work-replay.v1',
  executionAllowed: false,
  workItemId: '11111111-1111-4111-8111-111111111111',
  workflow: {
    key: 'assessment.iehp.prepare_for_clinical_review',
    version: 3,
    status: 'running',
  },
  steps: [],
  stateTransitions: [],
  evidence: [],
  approvals: [],
  attempts: [],
  effects: [],
};

const servers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all(
    Array.from(servers).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );
  servers.clear();
});

describe('agent-replay script', () => {
  it('prints only sanitized authoritative packet json from a loopback packet endpoint', async () => {
    let requestBody = '';
    const server = createServer((req, res) => {
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        requestBody += chunk;
      });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              replayPackets: [validPacket],
              responseBody: 'secret',
            },
          }),
        );
      });
    });
    servers.add(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }

    const scriptPath = path.join(process.cwd(), 'scripts', 'agent-replay.ts');
    const tsxPath = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          tsxPath,
          scriptPath,
          '--packet-url',
          `http://127.0.0.1:${address.port}/packet`,
          '--request-id',
          'req-123',
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });

      child.on('error', reject);
      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
    });

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(validPacket);
    expect(result.stdout).not.toContain('responseBody');
    expect(result.stdout).not.toContain('secret');
    expect(JSON.parse(requestBody)).toEqual({ mode: 'replay', requestId: 'req-123' });
  }, 60000);
});
