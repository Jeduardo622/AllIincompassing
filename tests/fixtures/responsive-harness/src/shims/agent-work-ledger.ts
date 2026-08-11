export const createCalOptimaWorkLedgerQueryOptions = () => ({
  queryKey: ["responsive-harness", "agent-work-ledger"],
  queryFn: async () => null,
  enabled: false,
  staleTime: Infinity,
});

export const createAssessmentWorkLedgerQueryOptions = () => ({
  queryKey: ["responsive-harness", "assessment-work-ledger"],
  queryFn: async () => null,
  enabled: false,
  staleTime: Infinity,
});

export const createCalOptimaDraftReviewWorkLedger = async () => ({
  id: "responsive-harness-ledger",
});

export const createIehpAssessmentPrepWorkLedger = async () => ({
  id: "responsive-harness-ledger",
});

export const decideAgentWorkApproval = async () => ({});

export const requestAgentWorkApprovalHandoff = async () => ({});
