import { describe, expect, it } from 'vitest';

import { runAgentEvalSmoke, buildSmokePayloads } from '../../../scripts/lib/agent-eval-smoke';

describe('agent eval smoke harness', () => {
  it('builds payloads with required fields', () => {
    const payloads = buildSmokePayloads('smoke-test');
    expect(payloads.aiAgentOptimized.message).toMatch(/read-only/i);
    expect(payloads.aiAgentOptimized.context).toMatchObject({
      conversationId: 'smoke-test',
    });
    expect(payloads.aiTranscription.audio).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(payloads.aiSessionNote.prompt).toMatch(/objective/i);
  });

  it('supports dry-run execution without network', async () => {
    const target = {
      supabaseUrl: 'dry-run',
      supabaseAnonKey: 'dry-run',
      edgeBaseUrl: 'dry-run',
      accessToken: 'dry-run',
    };
    const result = await runAgentEvalSmoke(target, { dryRun: true });
    expect(result.results.aiAgentOptimized.ok).toBe(true);
    expect(result.results.aiTranscription.ok).toBe(true);
    expect(result.results.aiSessionNoteGenerator.ok).toBe(true);
  });
});
