const CLIENT_BASE_COLUMNS = [
  'id',
  'client_id',
  'full_name',
  'email',
  'gender',
  'date_of_birth',
  'service_preference',
  'availability_hours',
  'one_to_one_units',
  'supervision_units',
  'parent_consult_units',
  'authorized_hours_per_month',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'deleted_at',
  'deleted_by',
  'organization_id',
  'status',
] as const;

type ClientVirtualRelation = 'one_supervision_units' | 'parent_consult_units';

const VIRTUAL_RELATION_MAPPINGS: Record<ClientVirtualRelation, string> = {
  // These relations do not exist as foreign tables in the public schema.
  // They correspond to aggregate columns on the clients table.
  // Requesting them as embeds causes PostgREST to return HTTP 400 (PGRST200).
  // Instead we project the underlying scalar columns directly.
  one_supervision_units: 'supervision_units',
  parent_consult_units: 'parent_consult_units',
};

const formatColumns = (columns: Iterable<string>): string => {
  return Array.from(columns).join(',\n  ');
};

export interface BuildClientSelectOptions {
  readonly include?: readonly string[];
}

export const buildClientSelect = (options: BuildClientSelectOptions = {}): string => {
  const columns = new Set<string>(CLIENT_BASE_COLUMNS);
  const relations: string[] = [];

  for (const token of options.include ?? []) {
    if (token in VIRTUAL_RELATION_MAPPINGS) {
      columns.add(VIRTUAL_RELATION_MAPPINGS[token as ClientVirtualRelation]);
      continue;
    }

    relations.push(token);
  }

  const columnClause = formatColumns(columns);
  if (relations.length === 0) {
    return columnClause;
  }

  const relationClause = relations.join(',\n  ');
  return `${columnClause},\n  ${relationClause}`;
};

export const CLIENT_SELECT = buildClientSelect({
  include: ['one_supervision_units', 'parent_consult_units'],
});

export const CLIENT_COLUMNS = [...CLIENT_BASE_COLUMNS];
