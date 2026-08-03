FROM denoland/deno:2.8.3 AS deno

FROM node:20.16.0-bookworm-slim

COPY --from=deno /usr/bin/deno /usr/bin/deno

WORKDIR /workspace
ENV DENO_DIR=/opt/deno

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

RUN test ! -d /workspace/docs \
  && test ! -d /workspace/reports \
  && test ! -d /workspace/artifacts \
  && test ! -d /workspace/.agents \
  && test ! -d /workspace/.cursor \
  && test ! -d /workspace/.codex \
  && test ! -d /workspace/.superpowers \
  && test -z "$(find /workspace -type f \( \
    -iname '*.pdf' -o -iname '*.doc' -o -iname '*.docx' \
    -o -iname '*.xls' -o -iname '*.xlsx' \
    -o -iname '*.ppt' -o -iname '*.pptx' \
    -o -iname '*.odt' -o -iname '*.ods' -o -iname '*.odp' \
    -o -iname '*.rtf' \
  \) -print -quit)"

LABEL phase2.image-content-policy="source-runtime-synthetic-tests-only"

# The repository lock is excluded from runtime use; this lock/cache is image-local.
RUN rm -f /workspace/deno.lock \
  && deno cache --node-modules-dir=auto --frozen=false \
    --lock=/opt/agent-work-ledger-deno.lock \
    supabase/functions/agent-work-items/index.ts \
    supabase/functions/agent-work-runner/index.ts \
    supabase/functions/agent-work-sweeper/index.ts \
    supabase/functions/_shared/agent-work/caloptima-draft-review.test.ts \
    supabase/functions/agent-work-items/index.test.ts \
    supabase/functions/agent-work-runner/index.test.ts \
    supabase/functions/agent-work-runner/chaos.test.ts \
    supabase/functions/agent-work-sweeper/index.test.ts \
    supabase/functions/generate-program-goals/index.ts \
    supabase/functions/generate-program-goals/index.test.ts \
    supabase/functions/generate-program-goals/ledger.test.ts \
  && test -s /opt/agent-work-ledger-deno.lock
