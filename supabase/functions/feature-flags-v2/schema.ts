// deno-lint-ignore-file no-import-prefix
import { z } from "npm:zod@3.23.8";
import { buildOrganizationMetadataSchema } from "./organizationMetadataSchema.builder.ts";

export const organizationMetadataSchema = buildOrganizationMetadataSchema(z);
export type OrganizationMetadata = z.infer<typeof organizationMetadataSchema>;


