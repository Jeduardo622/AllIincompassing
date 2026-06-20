import { describe, expect, it } from 'vitest';
import {
  mergeAuthorizationPdfPrefill,
  parseAuthorizationPdfText,
  type AuthorizationPdfPrefill,
} from '../pdfPrefill';

describe('parseAuthorizationPdfText', () => {
  it('extracts IEHP-style authorization fields from synthetic notice text', () => {
    const text = `
      Referral ID: IEHP-AUTH-12345
      Status: Approved
      Member ID: MEM-0001
      Diagnosis: F84.0 Autistic disorder
      Service From: 06/23/2026
      Service To: 12/22/2026
      Procedure Code 97153
      Requested Units: 120
      Approved Units: 96
    `;

    expect(parseAuthorizationPdfText(text)).toEqual({
      authorizationNumber: 'IEHP-AUTH-12345',
      status: 'approved',
      memberId: 'MEM-0001',
      diagnosisCode: 'F84.0',
      diagnosisDescription: 'Autistic disorder',
      startDate: '2026-06-23',
      endDate: '2026-12-22',
      services: [{ serviceCode: '97153', requestedUnits: 120, approvedUnits: 96 }],
    });
  });

  it('extracts CalOptima-style authorization fields from synthetic notice text', () => {
    const text = `
      Authorization #: CAL-987654
      Decision: Approved
      CIN: CIN-222333
      ICD-10 Code F84.0 - Autistic disorder
      Code Description From To Requested Approved
      97155 Adaptive behavior treatment 6.23.2026 12.22.2026 48 40
    `;

    expect(parseAuthorizationPdfText(text)).toMatchObject({
      authorizationNumber: 'CAL-987654',
      status: 'approved',
      memberId: 'CIN-222333',
      diagnosisCode: 'F84.0',
      diagnosisDescription: 'Autistic disorder',
      startDate: '2026-06-23',
      endDate: '2026-12-22',
      services: [{ serviceCode: '97155', requestedUnits: 48, approvedUnits: 40 }],
    });
  });

  it('leaves ambiguous values unset', () => {
    expect(parseAuthorizationPdfText('Authorization notice with no structured values')).toEqual({
      services: [],
    });
  });

  it('does not return impossible calendar dates', () => {
    const result = parseAuthorizationPdfText(`
      Authorization #: PDF-AUTH-BAD-DATES
      Service From: 02/31/2026
      Service To: 04/31/2026
      Procedure Code 97153
      Requested Units: 12
    `);

    expect(result).toMatchObject({
      authorizationNumber: 'PDF-AUTH-BAD-DATES',
      services: [{ serviceCode: '97153', requestedUnits: 12 }],
    });
    expect(result).not.toHaveProperty('startDate');
    expect(result).not.toHaveProperty('endDate');
  });

  it('drops a labeled date range when either side is invalid', () => {
    const result = parseAuthorizationPdfText(`
      Authorization #: PDF-AUTH-MIXED-DATES
      Service From: 02/31/2026
      Service To: 04/30/2026
      Procedure Code 97153
      Requested Units: 12
    `);

    expect(result).toMatchObject({
      authorizationNumber: 'PDF-AUTH-MIXED-DATES',
      services: [{ serviceCode: '97153', requestedUnits: 12 }],
    });
    expect(result).not.toHaveProperty('startDate');
    expect(result).not.toHaveProperty('endDate');
  });

  it('drops a compact date range when either side is invalid', () => {
    const result = parseAuthorizationPdfText(`
      Authorization #: PDF-AUTH-MIXED-TABLE
      Code Description From To Requested Approved
      97155 Adaptive behavior treatment 02.31.2026 04.30.2026 48 40
    `);

    expect(result).toMatchObject({
      authorizationNumber: 'PDF-AUTH-MIXED-TABLE',
      services: [{ serviceCode: '97155', requestedUnits: 48, approvedUnits: 40 }],
    });
    expect(result).not.toHaveProperty('startDate');
    expect(result).not.toHaveProperty('endDate');
  });

  it('prefers labeled authorization dates over service-row dates', () => {
    expect(
      parseAuthorizationPdfText(`
        Service From: 06/01/2026
        Service To: 12/31/2026
        Code Description From To Requested Approved
        H2019 Behavioral services 06/23/2026 12/22/2026 1560 1560
      `),
    ).toMatchObject({
      startDate: '2026-06-01',
      endDate: '2026-12-31',
      services: [{ serviceCode: 'H2019', requestedUnits: 1560, approvedUnits: 1560 }],
    });
  });

  it('does not infer status from requested or approved unit labels', () => {
    expect(
      parseAuthorizationPdfText(`
        Authorization #: PDF-AUTH-UNITS
        Procedure Code 97153
        Requested Units: 120
        Approved Units: 96
      `),
    ).toEqual({
      authorizationNumber: 'PDF-AUTH-UNITS',
      services: [{ serviceCode: '97153', requestedUnits: 120, approvedUnits: 96 }],
    });
  });

  it('does not infer status from requested or approved table columns', () => {
    const result = parseAuthorizationPdfText(`
      Authorization #: PDF-AUTH-TABLE
      Code Description From To Requested Approved
      97155 Adaptive behavior treatment 6.23.2026 12.22.2026 48 40
    `);

    expect(result).toMatchObject({
      authorizationNumber: 'PDF-AUTH-TABLE',
      startDate: '2026-06-23',
      endDate: '2026-12-22',
      services: [{ serviceCode: '97155', requestedUnits: 48, approvedUnits: 40 }],
    });
    expect(result).not.toHaveProperty('status');
  });

  it('does not apply global requested or approved units across multiple service codes', () => {
    expect(
      parseAuthorizationPdfText(`
        Authorization #: PDF-AUTH-MULTI-SERVICE
        Procedure Code 97153
        Procedure Code 97155
        Requested Units: 120
        Approved Units: 96
      `),
    ).toEqual({
      authorizationNumber: 'PDF-AUTH-MULTI-SERVICE',
      services: [{ serviceCode: '97153' }, { serviceCode: '97155' }],
    });
  });

  it('extracts pending status only from explicit status or decision wording', () => {
    expect(parseAuthorizationPdfText('Status: Pending')).toEqual({
      status: 'pending',
      services: [],
    });
    expect(parseAuthorizationPdfText('Decision: Requested')).toEqual({
      status: 'pending',
      services: [],
    });
  });

  it('recognizes active catalog service codes and split modifier codes exactly', () => {
    expect(
      parseAuthorizationPdfText(`
        Code Description From To Requested Approved
        97151 Behavior identification assessment 06/23/2026 12/22/2026 32 28
        97152 Behavior identification supporting assessment 06/23/2026 12/22/2026 8 8
        97154 Group adaptive behavior treatment 06/23/2026 12/22/2026 20 16
        97157 Multiple-family adaptive behavior treatment guidance 06/23/2026 12/22/2026 12 12
        H0032-HO Treatment planning supervision 06/23/2026 12/22/2026 10 10
      `),
    ).toMatchObject({
      services: [
        { serviceCode: '97151', requestedUnits: 32, approvedUnits: 28 },
        { serviceCode: '97152', requestedUnits: 8, approvedUnits: 8 },
        { serviceCode: '97154', requestedUnits: 20, approvedUnits: 16 },
        { serviceCode: '97157', requestedUnits: 12, approvedUnits: 12 },
        { serviceCode: 'H0032-HO', requestedUnits: 10, approvedUnits: 10 },
      ],
    });
  });

  it('does not treat generic leading numeric identifiers as service rows', () => {
    expect(
      parseAuthorizationPdfText(`
        12345 Member authorization tracking row 06/23/2026 12/22/2026 32 28
        ZIP Code 92345
      `),
    ).toEqual({
      startDate: '2026-06-23',
      endDate: '2026-12-22',
      services: [],
    });
  });

  it('recognizes split modifier codes when PDF text drops the hyphen', () => {
    expect(
      parseAuthorizationPdfText(`
        Code Description From To Requested Approved
        H0032HO Treatment planning supervision 06/23/2026 12/22/2026 10 10
      `),
    ).toMatchObject({
      services: [{ serviceCode: 'H0032HO', requestedUnits: 10, approvedUnits: 10 }],
    });
  });

  it('does not treat member names as member IDs', () => {
    expect(
      parseAuthorizationPdfText(`
        Member: Jane Doe
        Member ID: MEM-0001
        CIN: CIN-222333
      `),
    ).toMatchObject({
      memberId: 'MEM-0001',
      services: [],
    });
  });

  it('accepts unlabeled member values when they look like IDs', () => {
    expect(
      parseAuthorizationPdfText(`
        Member: MEM-0001
      `),
    ).toMatchObject({
      memberId: 'MEM-0001',
      services: [],
    });
  });

  it('does not infer full approval from negative or partial authorization prose', () => {
    expect(
      parseAuthorizationPdfText('Based on review, not all requested services have been authorized.'),
    ).toEqual({
      services: [],
    });
    expect(
      parseAuthorizationPdfText('Based on review, requested services have not been authorized.'),
    ).toEqual({
      services: [],
    });
    expect(
      parseAuthorizationPdfText('Based on review, requested services have been authorized in part.'),
    ).toEqual({
      services: [],
    });
    expect(
      parseAuthorizationPdfText('Based on review, requested services have been authorized, not all at the requested level.'),
    ).toEqual({
      services: [],
    });
    expect(
      parseAuthorizationPdfText('Based on review, requested services have been authorized with modifications.'),
    ).toEqual({
      services: [],
    });
  });

  it('extracts IEHP vertical procedure blocks with modifier rows', () => {
    expect(
      parseAuthorizationPdfText(`
        Referral ID: IEHP-AUTH-REAL-SHAPE
        Diagnosis
        1 (F84.0) - Autistic disorder
        Status: Approved Priority: Standard-Preservice
        1 Code
        H2019
        Requested
        Units
        Approved
        2080 Units
        Decision
        Approved
        Dates
        6/16/2026 -12/13/2026
        2 Code
        H0032
        Requested
        Units
        Approved
        832 Units
        Decision
        Approved
        Dates
        6/16/2026 -12/13/2026
        3 Code (Modifier)
        H0032 (HO)
        Requested
        Units
        Approved
        312 Units
        Decision
        Approved
        Dates
        6/16/2026 -12/13/2026
      `),
    ).toMatchObject({
      authorizationNumber: 'IEHP-AUTH-REAL-SHAPE',
      status: 'approved',
      diagnosisCode: 'F84.0',
      diagnosisDescription: 'Autistic disorder',
      startDate: '2026-06-16',
      endDate: '2026-12-13',
      services: [
        { serviceCode: 'H2019', approvedUnits: 2080 },
        { serviceCode: 'H0032', approvedUnits: 832 },
        { serviceCode: 'H0032-HO', approvedUnits: 312 },
      ],
    });
  });

  it('extracts approved IEHP vertical units when requested and approved rows differ', () => {
    expect(
      parseAuthorizationPdfText(`
        Referral ID: IEHP-AUTH-REQUESTED-APPROVED
        1 Code
        H2019
        Requested
        3000 Units
        Approved
        2080 Units
        Decision
        Approved
        Dates
        6/16/2026 -12/13/2026
      `),
    ).toMatchObject({
      authorizationNumber: 'IEHP-AUTH-REQUESTED-APPROVED',
      services: [{ serviceCode: 'H2019', approvedUnits: 2080 }],
    });
  });

  it('extracts IEHP vertical units from browser PDF text without row numbers', () => {
    expect(
      parseAuthorizationPdfText(`
        Status: Approved Priority: Standard-Preservice
        Code
        Requested
        Approved
        Dates
        H2019
        Units
        2080 Units
        Approved
        Code
        Requested
        Approved
        Dates
        H0032
        Units
        832 Units
        Approved
        Code (Modifier)
        Requested
        Approved
        Dates
        H0032 (HO)
        Units
        312 Units
        Approved
      `),
    ).toMatchObject({
      status: 'approved',
      services: [
        { serviceCode: 'H2019', approvedUnits: 2080 },
        { serviceCode: 'H0032', approvedUnits: 832 },
        { serviceCode: 'H0032-HO', approvedUnits: 312 },
      ],
    });
  });

  it('extracts CalOptima rows with OCR-like code and date separators', () => {
    expect(
      parseAuthorizationPdfText(`
        Provider Notice of Action / Preauthorization for Outpatient Services
        Member Name: Example Member CIN #: Z1234567Q
        Date of Birth: 09/04/2020 Authorization #: SYNTHAUTH1
        Diagnosis: Codes and Descriptions
        F84.0 - Autistic disorder
        Req Appr { Unit | Decision Code Description From Date{ To Date Units | Units | Type Status
        HO032HN SERVICE PLAN DVLP 06/23/2026 {12/22/2026{ 208 208 Units | Approved
        HO032HO | SERVICE PLAN DVLP 06/23/2026 {12/22/2026:] 104 104 Units | Approved
        H2019 BEHAVIORAL SERVICES {06/23/2026 {12/22/2026 1560 i 1560 i} Units | Approved
        Based on review, the above requested services has been authorized
      `),
    ).toMatchObject({
      authorizationNumber: 'SYNTHAUTH1',
      status: 'approved',
      memberId: 'Z1234567Q',
      diagnosisCode: 'F84.0',
      diagnosisDescription: 'Autistic disorder',
      startDate: '2026-06-23',
      endDate: '2026-12-22',
      services: [
        { serviceCode: 'H0032-HN', requestedUnits: 208, approvedUnits: 208 },
        { serviceCode: 'H0032-HO', requestedUnits: 104, approvedUnits: 104 },
        { serviceCode: 'H2019', requestedUnits: 1560, approvedUnits: 1560 },
      ],
    });
  });
});

describe('mergeAuthorizationPdfPrefill', () => {
  const catalog = {
    '97151': 'Behavior identification assessment',
    '97152': 'Behavior identification supporting assessment',
    '97153': 'Adaptive behavior treatment by protocol',
    '97154': 'Group adaptive behavior treatment',
    '97155': 'Adaptive behavior treatment with protocol modification',
    '97157': 'Multiple-family adaptive behavior treatment guidance',
    'H0032-HN': 'Treatment planning by non-physician',
    'H0032-HO': 'Treatment planning supervision',
  };

  it('fills empty fields and catalog-matched services without overwriting entered values', () => {
    const current = {
      authorizationNumber: 'ADMIN-TYPED',
      status: 'pending' as const,
      startDate: '',
      endDate: '',
      diagnosisCode: 'F84.0',
      diagnosisDescription: 'Autistic disorder',
      memberId: '',
      services: [] as string[],
      units: {} as Record<string, number>,
    };
    const prefill: AuthorizationPdfPrefill = {
      authorizationNumber: 'PDF-AUTH-1',
      status: 'approved',
      startDate: '2026-06-23',
      endDate: '2026-12-22',
      memberId: 'MEM-0001',
      services: [
        { serviceCode: '97153', requestedUnits: 120, approvedUnits: 96 },
        { serviceCode: '99999', requestedUnits: 1, approvedUnits: 1 },
      ],
    };

    expect(mergeAuthorizationPdfPrefill(current, prefill, catalog)).toEqual({
      data: {
        authorizationNumber: 'ADMIN-TYPED',
        status: 'pending',
        startDate: '2026-06-23',
        endDate: '2026-12-22',
        diagnosisCode: 'F84.0',
        diagnosisDescription: 'Autistic disorder',
        memberId: 'MEM-0001',
        services: ['97153'],
        units: { '97153': 96 },
      },
      appliedFields: ['startDate', 'endDate', 'memberId', 'services', 'units'],
      skippedServiceCodes: ['99999'],
    });
  });

  it('does not replace units for a service already selected by the admin', () => {
    const current = {
      authorizationNumber: '',
      status: 'approved' as const,
      startDate: '',
      endDate: '',
      diagnosisCode: '',
      diagnosisDescription: '',
      memberId: '',
      services: ['97153'],
      units: { '97153': 44 },
    };

    expect(
      mergeAuthorizationPdfPrefill(
        current,
        { services: [{ serviceCode: '97153', requestedUnits: 120, approvedUnits: 96 }] },
        catalog,
      ).data.units,
    ).toEqual({ '97153': 44 });
  });

  it('merges active catalog service codes and split modifier codes without skipping them', () => {
    const current = {
      authorizationNumber: '',
      status: 'approved' as const,
      startDate: '',
      endDate: '',
      diagnosisCode: '',
      diagnosisDescription: '',
      memberId: '',
      services: [] as string[],
      units: {} as Record<string, number>,
    };

    expect(
      mergeAuthorizationPdfPrefill(
        current,
        {
          services: [
            { serviceCode: '97151', approvedUnits: 28 },
            { serviceCode: '97152', approvedUnits: 8 },
            { serviceCode: '97154', approvedUnits: 16 },
            { serviceCode: '97157', approvedUnits: 12 },
            { serviceCode: 'H0032-HN', approvedUnits: 6 },
            { serviceCode: 'H0032-HO', approvedUnits: 10 },
          ],
        },
        catalog,
      ),
    ).toEqual({
      data: {
        ...current,
        services: ['97151', '97152', '97154', '97157', 'H0032-HN', 'H0032-HO'],
        units: {
          '97151': 28,
          '97152': 8,
          '97154': 16,
          '97157': 12,
          'H0032-HN': 6,
          'H0032-HO': 10,
        },
      },
      appliedFields: ['services', 'units'],
      skippedServiceCodes: [],
    });
  });

  it('matches split modifier PDF codes to unhyphenated catalog codes when unambiguous', () => {
    const current = {
      authorizationNumber: '',
      status: 'approved' as const,
      startDate: '',
      endDate: '',
      diagnosisCode: '',
      diagnosisDescription: '',
      memberId: '',
      services: [] as string[],
      units: {} as Record<string, number>,
    };

    expect(
      mergeAuthorizationPdfPrefill(
        current,
        { services: [{ serviceCode: 'H0032-HO', approvedUnits: 10 }] },
        { H0032HO: 'Treatment planning supervision' },
      ),
    ).toEqual({
      data: {
        ...current,
        services: ['H0032HO'],
        units: { H0032HO: 10 },
      },
      appliedFields: ['services', 'units'],
      skippedServiceCodes: [],
    });
  });

  it('matches hyphenless split modifier PDF codes to hyphenated catalog codes when unambiguous', () => {
    const current = {
      authorizationNumber: '',
      status: 'approved' as const,
      startDate: '',
      endDate: '',
      diagnosisCode: '',
      diagnosisDescription: '',
      memberId: '',
      services: [] as string[],
      units: {} as Record<string, number>,
    };

    expect(
      mergeAuthorizationPdfPrefill(
        current,
        { services: [{ serviceCode: 'H0032HO', approvedUnits: 10 }] },
        catalog,
      ),
    ).toEqual({
      data: {
        ...current,
        services: ['H0032-HO'],
        units: { 'H0032-HO': 10 },
      },
      appliedFields: ['services', 'units'],
      skippedServiceCodes: [],
    });
  });

  it('skips split modifier PDF codes when normalized catalog matching is ambiguous', () => {
    const current = {
      authorizationNumber: '',
      status: 'approved' as const,
      startDate: '',
      endDate: '',
      diagnosisCode: '',
      diagnosisDescription: '',
      memberId: '',
      services: [] as string[],
      units: {} as Record<string, number>,
    };

    expect(
      mergeAuthorizationPdfPrefill(
        current,
        { services: [{ serviceCode: 'H0032HO', approvedUnits: 10 }] },
        {
          'H0032-HO': 'Treatment planning supervision',
          H0032HO: 'Treatment planning supervision duplicate',
        },
      ),
    ).toEqual({
      data: current,
      appliedFields: [],
      skippedServiceCodes: ['H0032HO'],
    });
  });

  it('does not overwrite status by default when current status has a value', () => {
    const current = {
      authorizationNumber: '',
      status: 'approved' as const,
      startDate: '',
      endDate: '',
      diagnosisCode: '',
      diagnosisDescription: '',
      memberId: '',
      services: [] as string[],
      units: {} as Record<string, number>,
    };

    expect(
      mergeAuthorizationPdfPrefill(current, { status: 'denied', services: [] }, catalog),
    ).toEqual({
      data: current,
      appliedFields: [],
      skippedServiceCodes: [],
    });
  });

  it('applies status when the current status field is still defaulted', () => {
    const current = {
      authorizationNumber: '',
      status: 'approved' as const,
      startDate: '',
      endDate: '',
      diagnosisCode: '',
      diagnosisDescription: '',
      memberId: '',
      services: [] as string[],
      units: {} as Record<string, number>,
    };

    expect(
      mergeAuthorizationPdfPrefill(
        current,
        { status: 'denied', services: [] },
        catalog,
        { statusFieldIsDefault: true },
      ),
    ).toEqual({
      data: { ...current, status: 'denied' },
      appliedFields: ['status'],
      skippedServiceCodes: [],
    });
  });

  it('applies PDF diagnosis when the current diagnosis fields are still defaulted', () => {
    const current = {
      authorizationNumber: '',
      status: 'approved' as const,
      startDate: '',
      endDate: '',
      diagnosisCode: 'F84.0',
      diagnosisDescription: 'Autistic disorder',
      memberId: '',
      services: [] as string[],
      units: {} as Record<string, number>,
    };

    expect(
      mergeAuthorizationPdfPrefill(
        current,
        {
          diagnosisCode: 'F90.2',
          diagnosisDescription: 'Attention-deficit hyperactivity disorder, combined type',
          services: [],
        },
        catalog,
        {
          diagnosisCodeFieldIsDefault: true,
          diagnosisDescriptionFieldIsDefault: true,
        },
      ),
    ).toEqual({
      data: {
        ...current,
        diagnosisCode: 'F90.2',
        diagnosisDescription: 'Attention-deficit hyperactivity disorder, combined type',
      },
      appliedFields: ['diagnosisCode', 'diagnosisDescription'],
      skippedServiceCodes: [],
    });
  });

  it('does not overwrite admin-entered diagnosis fields when defaults were edited', () => {
    const current = {
      authorizationNumber: '',
      status: 'approved' as const,
      startDate: '',
      endDate: '',
      diagnosisCode: 'F90.2',
      diagnosisDescription: 'Attention-deficit hyperactivity disorder, combined type',
      memberId: '',
      services: [] as string[],
      units: {} as Record<string, number>,
    };

    expect(
      mergeAuthorizationPdfPrefill(
        current,
        {
          diagnosisCode: 'F84.0',
          diagnosisDescription: 'Autistic disorder',
          services: [],
        },
        catalog,
      ),
    ).toEqual({
      data: current,
      appliedFields: [],
      skippedServiceCodes: [],
    });
  });

  it('does not overwrite non-default diagnosis fields even when default flags are mistakenly true', () => {
    const current = {
      authorizationNumber: '',
      status: 'approved' as const,
      startDate: '',
      endDate: '',
      diagnosisCode: 'F90.2',
      diagnosisDescription: 'Attention-deficit hyperactivity disorder, combined type',
      memberId: '',
      services: [] as string[],
      units: {} as Record<string, number>,
    };

    expect(
      mergeAuthorizationPdfPrefill(
        current,
        {
          diagnosisCode: 'F84.0',
          diagnosisDescription: 'Autistic disorder',
          services: [],
        },
        catalog,
        {
          diagnosisCodeFieldIsDefault: true,
          diagnosisDescriptionFieldIsDefault: true,
        },
      ).data,
    ).toEqual(current);
  });
});
