import { z } from "npm:zod@3.23.8";
import { buildOrganizationMetadataSchema } from "../_shared/organizationMetadataSchema.builder.ts";

export const organizationMetadataSchema = buildOrganizationMetadataSchema(z);
export type OrganizationMetadata = z.infer<typeof organizationMetadataSchema>;
