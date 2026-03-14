const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/i;

export const toSupabaseBaseUrl = (value: string | undefined): string => {
  const normalized = value?.trim();
  if (!normalized) {
    return 'https://example.test';
  }

  if (PROJECT_REF_PATTERN.test(normalized)) {
    return `https://${normalized}.supabase.co`;
  }

  return normalized;
};

