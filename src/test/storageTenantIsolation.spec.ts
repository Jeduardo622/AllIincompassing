import { describe, expect, it } from 'vitest';

const buildStorageObjectsUrl = (objectPath: string): string => {
  const url = new URL('http://localhost/rest/v1/storage.objects');
  url.searchParams.set('select', '*');
  url.searchParams.set('bucket_id', 'eq.therapist-documents');
  url.searchParams.set('name', `eq.${objectPath}`);
  return url.toString();
};

const fetchStorageObjects = async (token: string, objectPath: string) => {
  const response = await fetch(buildStorageObjectsUrl(objectPath), {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: 'test-anon-key',
    },
  });
  const body = await response.json();
  return { response, body };
};

describe('therapist document storage tenant isolation', () => {
  const therapistIdOrgA = process.env.TEST_THERAPIST_ID_ORG_A ?? 'therapist-1';
  const therapistIdOrgB = process.env.TEST_THERAPIST_ID_ORG_B ?? 'therapist-2';
  const orgATherapistObject = `therapists/${therapistIdOrgA}/notes/intake.pdf`;
  const orgBTherapistObject = `therapists/${therapistIdOrgB}/notes/intake.pdf`;

  it('allows an org admin to access therapist documents within their organization', async () => {
    const token = process.env.TEST_JWT_ORG_A ?? '';
    const { response, body } = await fetchStorageObjects(token, orgATherapistObject);

    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0]?.name).toBe(orgATherapistObject);
  });

  it('allows a super admin scoped to the same org to access therapist documents', async () => {
    const token = process.env.TEST_JWT_SUPER_ADMIN ?? '';
    const { response, body } = await fetchStorageObjects(token, orgATherapistObject);

    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]?.owner).toBe(therapistIdOrgA);
  });

  it('denies admins from other organizations from accessing therapist documents', async () => {
    const token = process.env.TEST_JWT_ORG_B ?? '';
    const { response, body } = await fetchStorageObjects(token, orgATherapistObject);

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it('denies admins from accessing therapist documents for a different organization', async () => {
    const token = process.env.TEST_JWT_ORG_A ?? '';
    const { response, body } = await fetchStorageObjects(token, orgBTherapistObject);

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it('allows a therapist to access their own documents via folder scoping', async () => {
    const token = process.env.TEST_JWT_THERAPIST_ORG_A ?? '';
    const { response, body } = await fetchStorageObjects(token, orgATherapistObject);

    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]?.owner).toBe(therapistIdOrgA);
  });
});
