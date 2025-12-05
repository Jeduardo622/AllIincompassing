import os
chunk_size = 10
pending = []
with open('tmp/pending_list.txt', 'r', encoding='utf-8') as fh:
    lines = fh.readlines()
for line in lines[1:]:
    line = line.strip()
    if not line:
        continue
    parts = line.split(' ', 1)
    if len(parts) != 2:
        continue
    version, filename = parts
    pending.append((version.strip(), filename.strip()))
chunk = pending[:chunk_size]
if not chunk:
    raise SystemExit('No pending migrations to chunk')
parts = ['BEGIN;']
for version, filename in chunk:
    path = os.path.join('supabase', 'migrations', filename)
    with open(path, 'r', encoding='utf-8') as mf:
        sql = mf.read().strip()
    slug = filename[:-4].split('_', 1)[1] if '_' in filename[:-4] else filename[:-4]
    slug = slug.replace("'", "''")
    parts.append(f"-- BEGIN {filename}")
    parts.append(sql)
    parts.append(f"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('{version}','{slug}') ON CONFLICT (version) DO NOTHING;")
    parts.append(f"-- END {filename}\n")
parts.append('COMMIT;')
output = '\n\n'.join(parts)
out_path = os.path.join('tmp', 'chunk_01.sql')
with open(out_path, 'w', encoding='utf-8') as out:
    out.write(output)
print(f'Wrote {len(chunk)} migrations to {out_path}')
