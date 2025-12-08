const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
const versions = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => file.replace('.sql', ''))
  .filter((value, index, self) => self.indexOf(value) === index)
  .sort();

const valuesBlock = versions.map((version) => `('${version}')`).join(',\n       ');
const query = `with local(version) as (
       values
       ${valuesBlock}
)
select r.version, r.name
from supabase_migrations.schema_migrations r
left join local l on l.version = r.version
where l.version is null
order by r.version;`;

const outputPath = path.join(process.cwd(), 'tmp', 'missing_migrations_query.sql');
fs.writeFileSync(outputPath, query);
console.log(`Wrote query with ${versions.length} local versions to ${outputPath}`);

