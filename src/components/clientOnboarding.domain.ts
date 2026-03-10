import {
  SERVICE_CONTRACT_PROVIDER_OPTIONS,
  UNIVERSAL_CPT_CODE,
  UNIVERSAL_CPT_DESCRIPTION,
  type ServiceContractProvider,
} from "./clientOnboarding.constants";

interface CptCatalogRow {
  code: string | null;
  short_description: string | null;
}

export function buildAvailableCodesByProvider(cptCatalog: CptCatalogRow[]) {
  const grouped: Record<ServiceContractProvider, Array<{ code: string; description: string }>> = {
    Private: [],
    IEHP: [],
    CalOptima: [],
  };

  const pushIfMissing = (provider: ServiceContractProvider, code: string, description: string) => {
    if (!grouped[provider].some((entry) => entry.code === code)) {
      grouped[provider].push({ code, description });
    }
  };

  for (const code of cptCatalog) {
    const normalizedCode = String(code.code ?? "").toUpperCase();
    const description = String(code.short_description ?? "");
    if (!normalizedCode) continue;

    if (normalizedCode === UNIVERSAL_CPT_CODE) {
      const resolvedDescription = description || UNIVERSAL_CPT_DESCRIPTION;
      for (const provider of SERVICE_CONTRACT_PROVIDER_OPTIONS) {
        pushIfMissing(provider, normalizedCode, resolvedDescription);
      }
      continue;
    }

    if (normalizedCode.startsWith("9")) {
      pushIfMissing("Private", normalizedCode, description);
      continue;
    }

    if (normalizedCode.startsWith("H")) {
      pushIfMissing("IEHP", normalizedCode, description);
      pushIfMissing("CalOptima", normalizedCode, description);
    }
  }

  for (const provider of SERVICE_CONTRACT_PROVIDER_OPTIONS) {
    pushIfMissing(provider, UNIVERSAL_CPT_CODE, UNIVERSAL_CPT_DESCRIPTION);
  }

  return grouped;
}

