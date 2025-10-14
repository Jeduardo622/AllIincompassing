#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not available; tenant validation skipped."
  echo "Review ${SCRIPT_DIR}/tenant-validate.md for the expected commands."
  exit 0
fi

echo "Supabase CLI detected. Refer to the following checklist to validate tenant isolation:"
cat "${SCRIPT_DIR}/tenant-validate.md"
echo ""
echo "Run each command manually with the correct SUPABASE_PROJECT_REF to confirm RLS and grants."
