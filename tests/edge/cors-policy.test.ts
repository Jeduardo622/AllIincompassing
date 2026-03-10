import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const protectedFunctionFiles = [
  "supabase/functions/agent-trace-report/index.ts",
  "supabase/functions/ai-agent-optimized/index.ts",
  "supabase/functions/ai-session-note-generator/index.ts",
  "supabase/functions/ai-transcription/index.ts",
  "supabase/functions/extract-assessment-fields/index.ts",
  "supabase/functions/generate-program-goals/index.ts",
  "supabase/functions/get-therapist-details/index.ts",
  "supabase/functions/process-message/index.ts",
  "supabase/functions/sessions-cancel/index.ts",
  "supabase/functions/sessions-confirm/index.ts",
  "supabase/functions/sessions-hold/index.ts",
  "supabase/functions/suggest-alternative-times/index.ts",
  "supabase/functions/transcription-retention/index.ts",
];

describe("edge function CORS policy", () => {
  it("does not allow wildcard origins for protected edge functions", () => {
    const repoRoot = process.cwd();
    for (const file of protectedFunctionFiles) {
      const source = readFileSync(join(repoRoot, file), "utf8");
      expect(source).not.toContain('"Access-Control-Allow-Origin": "*"');
    }
  });
});

