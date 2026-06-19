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
});

describe('mergeAuthorizationPdfPrefill', () => {
  const catalog = {
    '97153': 'Adaptive behavior treatment by protocol',
    '97155': 'Adaptive behavior treatment with protocol modification',
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
});
