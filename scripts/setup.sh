#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# Codex environment bootstrap for AllIincompassing
# ------------------------------------------------------------------------------

set -euo pipefail

if [[ "${TRACE-}" == "1" ]]; then
  set -x
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f package.json ]]; then
  echo "❌  This script must be run from the repository root." >&2
  exit 1
fi

CLI_VERSION="${CLI_VERSION:-2.26.9}"
SUPABASE_CMD=(npx --yes "supabase@${CLI_VERSION}")

log() {
  printf '▶ %s\n' "$*"
}

warn() {
  printf '⚠️  %s\n' "$*" >&2
}

trap 'warn "Setup aborted"' ERR

log "Installing dependencies"
if [[ -f pnpm-lock.yaml ]]; then
  corepack enable &>/dev/null || true
  pnpm install --frozen-lockfile
elif [[ -f yarn.lock ]]; then
  corepack enable &>/dev/null || true
  yarn install --immutable
elif [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

log "Preparing non-interactive environment"
export CI=true

log "Validating Supabase environment"
required_env=(SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_ACCESS_TOKEN)
missing_env=()
for var in "${required_env[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    missing_env+=("$var")
  fi
done
if (( ${#missing_env[@]} > 0 )); then
  printf '❌  Missing required environment variables: %s\n' "${missing_env[*]}" >&2
  exit 1
fi

export SUPABASE_ACCESS_TOKEN SUPABASE_SERVICE_ROLE_KEY

log "Writing Supabase CLI config"
mkdir -p "$HOME/.supabase"
cat >"$HOME/.supabase/config.toml" <<CONFIG
[default]
access_token = "${SUPABASE_ACCESS_TOKEN}"
CONFIG
chmod 600 "$HOME/.supabase/config.toml"

log "Deriving project reference"
PROJECT_REF=$(printf '%s' "$SUPABASE_URL" | awk -F[/:.] '{print $(NF-2)}')
if [[ -z "$PROJECT_REF" ]]; then
  echo "❌  Could not determine project ref from SUPABASE_URL." >&2
  exit 1
fi
log "Project ref → $PROJECT_REF"

log "Ensuring generated types directory"
mkdir -p src/lib/generated

log "Generating TypeScript database types"
if "${SUPABASE_CMD[@]}" gen types --help | grep -q -- '--out-dir'; then
  if ! "${SUPABASE_CMD[@]}" gen types typescript \
    --project-id "$PROJECT_REF" \
    --schema public \
    --out-dir src/lib/generated; then
    warn "Type generation skipped (Supabase CLI error)"
  fi
else
  if ! "${SUPABASE_CMD[@]}" gen types typescript \
    --project-id "$PROJECT_REF" \
    --schema public \
    > src/lib/generated/database.types.ts; then
    warn "Type generation skipped (Supabase CLI error)"
  fi
fi

log "Writing Vite-compatible environment file"
cat > .env <<ENV
VITE_SUPABASE_URL=${SUPABASE_URL}
VITE_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
ENV

if [[ -f .gitignore ]]; then
  if ! grep -qx '\\.env' .gitignore; then
    printf '\n.env\n' >> .gitignore
    log "Added .env to .gitignore"
  fi
else
  printf '.env\n' > .gitignore
  log "Created .gitignore with .env entry"
fi

log "Optimising Cypress install"
: "${CYPRESS_RUN:=false}"
if [[ "$CYPRESS_RUN" != "true" ]]; then
  export CYPRESS_INSTALL_BINARY=0
fi

log "Verifying Supabase CLI availability"
CLI_REPORTED_VERSION=$("${SUPABASE_CMD[@]}" --version)
log "Supabase CLI version → ${CLI_REPORTED_VERSION}"

log "Setup summary"
printf '   • Package manager : %s\n' "$(npm exec --yes which npm | xargs dirname | xargs basename)"
printf '   • Project ref     : %s\n' "$PROJECT_REF"

trap - ERR
log "Setup completed"
