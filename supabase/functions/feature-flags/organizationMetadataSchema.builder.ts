type ZodModule = typeof import("zod");
type ZodNamespace = ZodModule extends { z: infer Namespace } ? Namespace : never;

export const buildOrganizationMetadataSchema = (zLib: ZodNamespace) => {
  const contactSchema = zLib
    .object({
      name: zLib.string().trim().min(1, "Billing contact name is required").max(120),
      email: zLib
        .string()
        .trim()
        .email("Billing contact email must be valid")
        .max(320),
      phone: zLib
        .string()
        .trim()
        .regex(/^[+0-9().\-\s]*$/, "Phone numbers may contain digits and basic symbols only")
        .max(40)
        .optional(),
    })
    .strict();

  const rolloutSchema = zLib
    .object({
      cohort: zLib.string().trim().min(1, "Rollout cohort is required").max(100),
      startAt: zLib.string().trim().datetime({ offset: true }),
      flags: zLib.array(zLib.string().trim().min(2).max(100)).max(20).optional(),
    })
    .partial()
    .refine(
      (value) => !value || Object.values(value).some((field) => field !== undefined),
      {
        message: "Rollout details cannot be empty",
      },
    );

  return zLib
    .object({
      billing: zLib
        .object({
          contact: contactSchema.optional(),
          cycle: zLib.enum(["monthly", "quarterly", "annual"]).optional(),
          poNumber: zLib.string().trim().max(50).optional(),
        })
        .optional(),
      seats: zLib
        .object({
          licensed: zLib.number().int().min(0).max(100000).optional(),
          active: zLib.number().int().min(0).max(100000).optional(),
        })
        .superRefine((value, ctx) => {
          if (!value || value.licensed === undefined || value.active === undefined) {
            return;
          }

          if (value.active > value.licensed) {
            ctx.addIssue({
              code: "custom",
              message: "Active seats cannot exceed licensed seats",
              path: ["active"],
            });
          }
        })
        .optional(),
      rollout: rolloutSchema.optional(),
      tags: zLib.array(zLib.string().trim().min(1).max(50)).max(10).optional(),
      notes: zLib.string().trim().max(1000).optional(),
    })
    .strict();
};

export type OrganizationMetadataSchema = ReturnType<typeof buildOrganizationMetadataSchema>;


