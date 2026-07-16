import { z } from 'zod';

export type BtAbaSessionNoteResponses = {
  purpose_of_session: string[];
  purpose_other?: string;
  client_status: string;
  skill_strategies: string[];
  skill_strategies_other?: string;
  behavior_strategies: string[];
  behavior_strategies_other?: string;
  supervisor_support: string[];
  supervisor_support_other?: string;
  progress_toward_goals: string;
  client_response_to_treatment: string;
  data_point_scope: 'linked' | 'all';
  link_unlinked_data: boolean;
  bt_signature: { method: 'drawn' | 'typed'; value: string };
};

export const BT_ABA_SESSION_NOTE_TEMPLATE_TYPE = 'bt_aba_session_note' as const;

const requiredSelections = z.array(z.string().trim().min(1)).min(1);

const btAbaSessionNoteResponsesSchema: z.ZodType<BtAbaSessionNoteResponses> = z.object({
  purpose_of_session: requiredSelections,
  purpose_other: z.string().trim().optional(),
  client_status: z.string().trim().min(1),
  skill_strategies: requiredSelections,
  skill_strategies_other: z.string().trim().optional(),
  behavior_strategies: requiredSelections,
  behavior_strategies_other: z.string().trim().optional(),
  supervisor_support: requiredSelections,
  supervisor_support_other: z.string().trim().optional(),
  progress_toward_goals: z.string().trim().min(1),
  client_response_to_treatment: z.string().trim().min(1),
  data_point_scope: z.enum(['linked', 'all']),
  link_unlinked_data: z.boolean(),
  bt_signature: z.object({
    method: z.enum(['drawn', 'typed']),
    value: z.string().trim().min(1),
  }),
}).superRefine((responses, context) => {
  const selectionGroups = [
    ['purpose_of_session', 'purpose_other'],
    ['skill_strategies', 'skill_strategies_other'],
    ['behavior_strategies', 'behavior_strategies_other'],
    ['supervisor_support', 'supervisor_support_other'],
  ] as const;

  for (const [group, otherNarrative] of selectionGroups) {
    const selections = responses[group];

    if (selections.includes('Other') && !responses[otherNarrative]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Other narrative is required when Other is selected',
        path: [otherNarrative],
      });
    }

    if (selections.includes('N/A') && selections.length > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'N/A must be selected exclusively',
        path: [group],
      });
    }
  }
});

export const validateBtAbaSessionNoteResponses = (responses: unknown) =>
  btAbaSessionNoteResponsesSchema.safeParse(responses);

export const normalizeExclusiveSelections = (
  selections: string[],
  exclusiveSelection: string,
): string[] => selections.includes(exclusiveSelection) ? [exclusiveSelection] : selections;
