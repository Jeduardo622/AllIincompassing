import type { ClientFormData } from "../lib/validationSchemas";

export const DEFAULT_AVAILABILITY = {
  monday: { start: "06:00", end: "21:00" },
  tuesday: { start: "06:00", end: "21:00" },
  wednesday: { start: "06:00", end: "21:00" },
  thursday: { start: "06:00", end: "21:00" },
  friday: { start: "06:00", end: "21:00" },
  saturday: { start: "06:00", end: "21:00" },
};

export const SERVICE_CONTRACT_PROVIDER_OPTIONS = ["Private", "IEHP", "CalOptima"] as const;
export type ServiceContractProvider = typeof SERVICE_CONTRACT_PROVIDER_OPTIONS[number];

export const UNIVERSAL_CPT_CODE = "S5110";
export const UNIVERSAL_CPT_DESCRIPTION = "Parent consultation";

export const STEP_FIELDS: Record<number, Array<keyof ClientFormData>> = {
  1: ["first_name", "last_name", "date_of_birth", "email", "gender", "phone", "client_id", "cin_number"],
  2: [
    "parent1_first_name",
    "parent1_last_name",
    "parent1_phone",
    "parent1_email",
    "parent1_relationship",
    "parent2_first_name",
    "parent2_last_name",
    "parent2_phone",
    "parent2_email",
    "parent2_relationship",
  ],
  3: ["address_line1", "address_line2", "city", "state", "zip_code"],
  4: [
    "service_preference",
    "one_to_one_units",
    "supervision_units",
    "parent_consult_units",
    "assessment_units",
    "auth_units",
    "auth_start_date",
    "auth_end_date",
    "service_contracts",
    "insurance_info",
  ],
};

export const getCodePrefixForProvider = (
  provider: ServiceContractProvider,
): "9" | "H" => (provider === "Private" ? "9" : "H");

export const isCodeAllowedForProvider = (
  provider: ServiceContractProvider,
  code: unknown,
): boolean => {
  const normalizedCode = String(code ?? "").trim().toUpperCase();
  if (!normalizedCode) {
    return false;
  }
  if (normalizedCode === UNIVERSAL_CPT_CODE) {
    return true;
  }
  return normalizedCode.startsWith(getCodePrefixForProvider(provider));
};
