const CLIENT_BASE_COLUMNS = [
  'id',
  'client_id',
  'full_name',
  'first_name',
  'middle_name',
  'last_name',
  'email',
  'gender',
  'date_of_birth',
  'service_preference',
  'availability_hours',
  'insurance_info',
  'phone',
  'cin_number',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip_code',
  'parent1_first_name',
  'parent1_last_name',
  'parent1_phone',
  'parent1_email',
  'parent1_relationship',
  'parent2_first_name',
  'parent2_last_name',
  'parent2_phone',
  'parent2_email',
  'parent2_relationship',
  'one_to_one_units',
  'supervision_units',
  'parent_consult_units',
  'assessment_units',
  'auth_units',
  'auth_start_date',
  'auth_end_date',
  'authorized_hours_per_month',
  'therapist_id',
  'therapist_assigned_at',
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
