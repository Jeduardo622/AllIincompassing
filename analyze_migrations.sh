#!/bin/bash

echo "Analyzing Supabase Migrations..."
echo "===============================\n"

# Count total migrations
TOTAL_MIGRATIONS=$(ls -1 supabase/migrations/*.sql 2>/dev/null | wc -l)
echo "Total migrations: $TOTAL_MIGRATIONS"

# Check for discarded migrations
DISCARDED_COUNT=0
if [ -d .bolt/supabase_discarded_migrations ]; then
  DISCARDED_COUNT=$(ls -1 .bolt/supabase_discarded_migrations/*.sql 2>/dev/null | wc -l)
  echo "Discarded migrations: $DISCARDED_COUNT"
fi

# Check for special migration files
SPECIAL_FILES=$(grep -l "phase" supabase/migrations/*.sql 2>/dev/null | wc -l)
echo "Phase-specific migrations: $SPECIAL_FILES"

# List critical migrations
echo "\nCritical migrations:"
grep -l "phase\|schema_alignment\|fix_auth" supabase/migrations/*.sql 2>/dev/null

echo "\nMigration file naming pattern analysis:"
ls -1 supabase/migrations/*.sql 2>/dev/null | grep -o "[0-9]\{8\}" | sort | uniq -c

echo "\nLatest 5 migration files:"
ls -t supabase/migrations/*.sql 2>/dev/null | head -5