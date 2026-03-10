import { describe, expect, it } from 'vitest';
import {
  CLIENT_COLUMNS,
  CLIENT_DETAIL_SELECT,
  CLIENT_LIST_SELECT,
  CLIENT_SELECT,
  buildClientSelect,
} from '../select';

describe('buildClientSelect', () => {
  it('includes all baseline client columns', () => {
    const selectClause = buildClientSelect({ scope: 'detail' });
    CLIENT_COLUMNS.forEach((column) => {
      expect(selectClause).toContain(column);
    });
  });

  it('replaces deprecated embed tokens with scalar columns', () => {
    const selectClause = buildClientSelect({
      include: ['one_supervision_units', 'parent_consult_units'],
    });

    expect(selectClause).toContain('supervision_units');
    expect(selectClause).toContain('parent_consult_units');
    expect(selectClause).not.toContain('one_supervision_units(');
    expect(selectClause).not.toContain('parent_consult_units(');
  });

  it('exposes a reusable clause constant with the sanitized columns', () => {
    expect(CLIENT_SELECT).toBe(buildClientSelect({
      include: ['one_supervision_units', 'parent_consult_units'],
    }));
    expect(CLIENT_LIST_SELECT).toBe(CLIENT_SELECT);
    expect(CLIENT_DETAIL_SELECT).toBe(buildClientSelect({
      scope: 'detail',
      include: ['one_supervision_units', 'parent_consult_units'],
    }));
    expect(CLIENT_DETAIL_SELECT).toContain('parent1_email');
    expect(CLIENT_LIST_SELECT).not.toContain('parent1_email');
  });
});
