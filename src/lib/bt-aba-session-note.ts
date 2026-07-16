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

export const BT_ABA_PURPOSE_OPTIONS = [
  'RBT/BT worked on goals as stated in the treatment plan',
  'RBT/BT worked on pairing self with reinforcers',
  'Other',
] as const;

export const BT_ABA_SKILL_STRATEGY_OPTIONS = [
  'Role playing or modeling',
  'Generalization training',
  'Natural environment teaching',
  'Discrete trial training',
  'Shaping/Chaining',
  'Providing support with prompt fading',
  'Behavior Momentum',
  'Other',
  'N/A',
] as const;

export const BT_ABA_BEHAVIOR_STRATEGY_OPTIONS = [
  'Modeling',
  'Verbal reminders provided',
  'Contingent rewards/reinforcers',
  'Guided Compliance',
  'First/Then statements',
  'Visual supports',
  'Differential Reinforcement',
  'Other',
  'N/A',
] as const;

export const BT_ABA_SUPERVISOR_SUPPORT_OPTIONS = [
  'Supervisor did not attend this session',
  'Problem-solved concerns',
  'Supervisor provided some direct support',
  'Modeled strategies/interventions',
  'Discussed programs/progress/data collection',
  'Other',
] as const;

export const BT_ABA_FIELD_LABELS = {
  purpose_of_session: 'Purpose of Session',
  purpose_other: 'Describe Other',
  client_status: 'Client Status',
  skill_strategies: 'Skill Strategies',
  skill_strategies_other: 'Describe Other Skill Strategy',
  behavior_strategies: 'Behavior Strategies',
  behavior_strategies_other: 'Describe Other Behavior Strategy',
  supervisor_support: 'Supervisor Support and Discussion Included',
  supervisor_support_other: 'Describe Other Supervisor Support',
  progress_toward_goals: 'Summary of Progress Toward Treatment Goals',
  client_response_to_treatment: "Client's Response to Treatment",
  data_point_scope: 'Data Point Scope',
  link_unlinked_data: 'Link Unlinked Data',
  bt_signature: 'Behavior Technician Signature',
} as const;

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
