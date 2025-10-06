import { z } from "zod";
import { buildOrganizationMetadataSchema } from "./organizationMetadataSchema.builder";

export const organizationMetadataSchema = buildOrganizationMetadataSchema(z);
export type OrganizationMetadata = z.infer<typeof organizationMetadataSchema>;
