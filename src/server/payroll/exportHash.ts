import { createHash } from "node:crypto";
import { renderProviderNeutralCsvV1 } from "./csvAdapterV1";
import type { CanonicalPayrollRow } from "./exportTypes";

export function sha256ProviderNeutralCsvV1(rows: readonly CanonicalPayrollRow[]): string {
  return createHash("sha256")
    .update(renderProviderNeutralCsvV1(rows), "utf8")
    .digest("hex");
}
