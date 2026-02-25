import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, Trash2, UploadCloud } from "lucide-react";
import type { Client, Goal, Program, ProgramNote } from "../../types";
import { callApi } from "../../lib/api";
import { showError, showInfo, showSuccess } from "../../lib/toast";
import { useActiveOrganizationId } from "../../lib/organization";
import { generateProgramGoalDraft, type ProgramGoalDraftResponse } from "../../lib/ai";
import { useAuth } from "../../lib/authContext";
import {
  registerAssessmentDocument,
  type AssessmentDocumentRecord,
  type AssessmentTemplateType,
} from "../../lib/assessment-documents";
import { supabase } from "../../lib/supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ProgramsGoalsTabProps {
  client: Client;
}

interface AssessmentChecklistItem {
  id: string;
  section_key: string;
  label: string;
  placeholder_key: string;
  required: boolean;
  mode: "AUTO" | "ASSISTED" | "MANUAL";
  status: "not_started" | "drafted" | "verified" | "approved";
  review_notes: string | null;
  value_text: string | null;
}

interface AssessmentDraftProgram {
  id: string;
  name: string;
  description: string | null;
  accept_state: "pending" | "accepted" | "rejected" | "edited";
  review_notes: string | null;
}

interface AssessmentDraftGoal {
  id: string;
  title: string;
  description: string;
  original_text: string;
  accept_state: "pending" | "accepted" | "rejected" | "edited";
  review_notes: string | null;
}

interface AssessmentDraftResponse {
  programs: AssessmentDraftProgram[];
  goals: AssessmentDraftGoal[];
}

interface AssessmentPlanPdfResponse {
  fill_mode: "acroform" | "overlay";
  signed_url: string;
  object_path: string;
}

const EMPTY_ASSESSMENT_DOCUMENTS: AssessmentDocumentRecord[] = [];
const EMPTY_CHECKLIST_ITEMS: AssessmentChecklistItem[] = [];
const EMPTY_ASSESSMENT_DRAFTS: AssessmentDraftResponse = { programs: [], goals: [] };
const ENABLE_CHECKLIST_MAPPING_UI = false;

const TEMPLATE_LABELS: Record<AssessmentTemplateType, string> = {
  caloptima_fba: "CalOptima FBA",
  iehp_fba: "IEHP FBA",
};

const parseJson = async <T,>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text) {
    return [] as unknown as T;
  }
  return JSON.parse(text) as T;
};

const parseApiErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  const text = await response.text();
  if (!text) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
    return fallback;
  } catch {
    return fallback;
  }
};

const statusToneByAssessment: Record<
  AssessmentDocumentRecord["status"],
  { label: string; className: string }
> = {
  uploaded: { label: "uploaded", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  extracting: { label: "extracting", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200" },
  extracted: { label: "extracted", className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200" },
  drafted: { label: "ai proposal ready", className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200" },
  approved: { label: "approved", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" },
  rejected: { label: "rejected", className: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200" },
  extraction_failed: {
    label: "extraction failed",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
  },
};

export default function ProgramsGoalsTab({ client }: ProgramsGoalsTabProps) {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();
  const { session } = useAuth();
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | null>(null);
  const [assessmentFile, setAssessmentFile] = useState<File | null>(null);
  const [assessmentTemplateType, setAssessmentTemplateType] = useState<AssessmentTemplateType>("caloptima_fba");
  const [programName, setProgramName] = useState("");
  const [programDescription, setProgramDescription] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [goalOriginalText, setGoalOriginalText] = useState("");
  const [assessmentInput, setAssessmentInput] = useState("");
  const [draftPlan, setDraftPlan] = useState<ProgramGoalDraftResponse | null>(null);
  const [checklistEdits, setChecklistEdits] = useState<
    Record<string, { status: AssessmentChecklistItem["status"]; reviewNotes: string; valueText: string }>
  >({});
  const [draftProgramEdits, setDraftProgramEdits] = useState<
    Record<string, { acceptState: AssessmentDraftProgram["accept_state"]; reviewNotes: string; name: string; description: string }>
  >({});
  const [draftGoalEdits, setDraftGoalEdits] = useState<
    Record<
      string,
      {
        acceptState: AssessmentDraftGoal["accept_state"];
        reviewNotes: string;
        title: string;
        description: string;
        originalText: string;
      }
    >
  >({});
  const [noteType, setNoteType] = useState<ProgramNote["note_type"]>("plan_update");
  const [noteContent, setNoteContent] = useState("");
  const [deletingAssessmentId, setDeletingAssessmentId] = useState<string | null>(null);

  const applyDraftGoal = (goal: ProgramGoalDraftResponse["goals"][number]) => {
    setGoalTitle(goal.title);
    setGoalDescription(goal.description);
    setGoalOriginalText(goal.original_text);
  };

  const { data: programs = [], isLoading: programsLoading } = useQuery({
    queryKey: ["client-programs", client.id, organizationId ?? "MISSING_ORG"],
    queryFn: async () => {
      if (!organizationId) {
        throw new Error("Organization context is required to load programs.");
      }
      const response = await callApi(`/api/programs?client_id=${encodeURIComponent(client.id)}`);
      if (!response.ok) {
        throw new Error("Failed to load programs");
      }
      return parseJson<Program[]>(response);
    },
    enabled: Boolean(client.id && organizationId),
  });

  const resolvedProgramId = useMemo(() => {
    if (selectedProgramId) return selectedProgramId;
    return programs.find((program) => program.status === "active")?.id ?? programs[0]?.id ?? null;
  }, [programs, selectedProgramId]);

  const { data: goals = [], isLoading: goalsLoading } = useQuery({
    queryKey: ["program-goals", resolvedProgramId, organizationId ?? "MISSING_ORG"],
    queryFn: async () => {
      if (!resolvedProgramId) return [];
      const response = await callApi(`/api/goals?program_id=${encodeURIComponent(resolvedProgramId)}`);
      if (!response.ok) {
        throw new Error("Failed to load goals");
      }
      return parseJson<Goal[]>(response);
    },
    enabled: Boolean(resolvedProgramId),
  });

  const { data: programNotes = [] } = useQuery({
    queryKey: ["program-notes", resolvedProgramId, organizationId ?? "MISSING_ORG"],
    queryFn: async () => {
      if (!resolvedProgramId) return [];
      const response = await callApi(`/api/program-notes?program_id=${encodeURIComponent(resolvedProgramId)}`);
      if (!response.ok) {
        throw new Error("Failed to load program notes");
      }
      return parseJson<ProgramNote[]>(response);
    },
    enabled: Boolean(resolvedProgramId),
  });

  const { data: assessmentDocuments = EMPTY_ASSESSMENT_DOCUMENTS, isLoading: assessmentLoading } = useQuery({
    queryKey: ["assessment-documents", client.id, organizationId ?? "MISSING_ORG"],
    queryFn: async () => {
      const response = await callApi(`/api/assessment-documents?client_id=${encodeURIComponent(client.id)}`);
      if (!response.ok) {
        throw new Error("Failed to load assessment documents");
      }
      return parseJson<AssessmentDocumentRecord[]>(response);
    },
    enabled: Boolean(client.id && organizationId),
  });
  const selectedAssessmentIdIsValid = Boolean(selectedAssessmentId && UUID_PATTERN.test(selectedAssessmentId));
  const selectedAssessmentInQueue = Boolean(
    selectedAssessmentId && assessmentDocuments.some((document) => document.id === selectedAssessmentId),
  );
  const canQuerySelectedAssessment = selectedAssessmentIdIsValid && selectedAssessmentInQueue;

  const { data: checklistItems = EMPTY_CHECKLIST_ITEMS } = useQuery({
    queryKey: ["assessment-checklist", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
    queryFn: async () => {
      if (!selectedAssessmentId) return [];
      const response = await callApi(
        `/api/assessment-checklist?assessment_document_id=${encodeURIComponent(selectedAssessmentId)}`,
      );
      if (!response.ok) {
        throw new Error("Failed to load checklist");
      }
      return parseJson<AssessmentChecklistItem[]>(response);
    },
    enabled: canQuerySelectedAssessment && ENABLE_CHECKLIST_MAPPING_UI,
  });

  const { data: assessmentDrafts } = useQuery({
    queryKey: ["assessment-drafts", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
    queryFn: async () => {
      if (!selectedAssessmentId) return EMPTY_ASSESSMENT_DRAFTS;
      const response = await callApi(`/api/assessment-drafts?assessment_document_id=${encodeURIComponent(selectedAssessmentId)}`);
      if (!response.ok) {
        throw new Error("Failed to load assessment drafts");
      }
      return parseJson<AssessmentDraftResponse>(response);
    },
    enabled: canQuerySelectedAssessment,
  });

  const checklistBySection = useMemo(() => {
    const grouped = new Map<string, AssessmentChecklistItem[]>();
    checklistItems.forEach((item) => {
      const existing = grouped.get(item.section_key) ?? [];
      existing.push(item);
      grouped.set(item.section_key, existing);
    });
    return Array.from(grouped.entries());
  }, [checklistItems]);

  const selectedAssessmentDocument = useMemo(
    () => assessmentDocuments.find((document) => document.id === selectedAssessmentId) ?? null,
    [assessmentDocuments, selectedAssessmentId],
  );
  const selectedAssessmentTemplateLabel = selectedAssessmentDocument
    ? TEMPLATE_LABELS[selectedAssessmentDocument.template_type]
    : TEMPLATE_LABELS[assessmentTemplateType];
  const hasPendingRequiredChecklistItems =
    ENABLE_CHECKLIST_MAPPING_UI && checklistItems.some((item) => item.required && item.status !== "approved");
  const hasAcceptedDraftProgram = (assessmentDrafts?.programs ?? []).some(
    (program) => program.accept_state === "accepted" || program.accept_state === "edited",
  );
  const hasAcceptedDraftGoal = (assessmentDrafts?.goals ?? []).some(
    (goal) => goal.accept_state === "accepted" || goal.accept_state === "edited",
  );
  const canPromoteAssessment =
    canQuerySelectedAssessment && !hasPendingRequiredChecklistItems && hasAcceptedDraftProgram && hasAcceptedDraftGoal;
  const unresolvedRequiredCount = ENABLE_CHECKLIST_MAPPING_UI
    ? checklistItems.filter((item) => item.required && item.status !== "approved").length
    : 0;
  const promoteDisabledReason = !canQuerySelectedAssessment
    ? "Select a valid assessment first."
    : !hasAcceptedDraftProgram
        ? "Accept or edit at least one AI proposal program before publishing."
        : !hasAcceptedDraftGoal
          ? "Accept or edit at least one AI proposal goal before publishing."
          : null;

  useEffect(() => {
    const firstAssessmentId = assessmentDocuments[0]?.id ?? null;
    if (!firstAssessmentId) {
      if (assessmentLoading) {
        return;
      }
      if (selectedAssessmentId !== null) {
        showInfo("Assessment selection was cleared because no assessments are available for this client.");
        setSelectedAssessmentId(null);
      }
      return;
    }
    if (!selectedAssessmentId || !assessmentDocuments.some((document) => document.id === selectedAssessmentId)) {
      if (selectedAssessmentId && selectedAssessmentId !== firstAssessmentId) {
        showInfo("Assessment selection was updated to match this client's available queue.");
      }
      setSelectedAssessmentId(firstAssessmentId);
    }
  }, [assessmentDocuments, selectedAssessmentId, assessmentLoading]);

  useEffect(() => {
    const next: Record<string, { status: AssessmentChecklistItem["status"]; reviewNotes: string; valueText: string }> = {};
    checklistItems.forEach((item) => {
      next[item.id] = {
        status: item.status,
        reviewNotes: item.review_notes ?? "",
        valueText: item.value_text ?? "",
      };
    });
    setChecklistEdits(next);
  }, [checklistItems]);

  useEffect(() => {
    const nextPrograms: Record<
      string,
      { acceptState: AssessmentDraftProgram["accept_state"]; reviewNotes: string; name: string; description: string }
    > = {};
    (assessmentDrafts?.programs ?? []).forEach((program) => {
      nextPrograms[program.id] = {
        acceptState: program.accept_state,
        reviewNotes: program.review_notes ?? "",
        name: program.name,
        description: program.description ?? "",
      };
    });
    setDraftProgramEdits(nextPrograms);

    const nextGoals: Record<
      string,
      { acceptState: AssessmentDraftGoal["accept_state"]; reviewNotes: string; title: string; description: string; originalText: string }
    > = {};
    (assessmentDrafts?.goals ?? []).forEach((goal) => {
      nextGoals[goal.id] = {
        acceptState: goal.accept_state,
        reviewNotes: goal.review_notes ?? "",
        title: goal.title,
        description: goal.description,
        originalText: goal.original_text,
      };
    });
    setDraftGoalEdits(nextGoals);
  }, [assessmentDrafts?.goals, assessmentDrafts?.programs]);

  const uploadAssessment = useMutation({
    mutationFn: async () => {
      if (!assessmentFile) {
        throw new Error("Select a file before uploading.");
      }
      const filePath = `clients/${client.id}/assessments/${Date.now()}-${assessmentFile.name.replace(/\s+/g, "-")}`;
      const { error: uploadError } = await supabase.storage.from("client-documents").upload(filePath, assessmentFile);
      if (uploadError) {
        throw uploadError;
      }
      return registerAssessmentDocument({
        client_id: client.id,
        file_name: assessmentFile.name,
        mime_type: assessmentFile.type || "application/octet-stream",
        file_size: assessmentFile.size,
        bucket_id: "client-documents",
        object_path: filePath,
        template_type: assessmentTemplateType,
      });
    },
    onSuccess: (created) => {
      const createdTemplateLabel = TEMPLATE_LABELS[created.template_type];
      setAssessmentFile(null);
      setSelectedAssessmentId(created.id);
      queryClient.invalidateQueries({
        queryKey: ["assessment-documents", client.id, organizationId ?? "MISSING_ORG"],
      });
      showSuccess(`${createdTemplateLabel} uploaded and checklist initialized.`);
    },
    onError: showError,
  });

  const updateChecklistItem = useMutation({
    mutationFn: async (itemId: string) => {
      const edit = checklistEdits[itemId];
      if (!edit) {
        throw new Error("Checklist row edit state not found.");
      }
      const response = await callApi("/api/assessment-checklist", {
        method: "PATCH",
        body: JSON.stringify({
          item_id: itemId,
          status: edit.status,
          review_notes: edit.reviewNotes,
          value_text: edit.valueText,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to update checklist row");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["assessment-checklist", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
      });
      showSuccess("Checklist row updated.");
    },
    onError: showError,
  });

  const deleteAssessmentDocument = useMutation({
    mutationFn: async (document: AssessmentDocumentRecord) => {
      const { error: storageError } = await supabase.storage.from(document.bucket_id).remove([document.object_path]);
      if (storageError) {
        // Storage cleanup can fail on already-deleted objects; continue with database cleanup.
        console.warn("Failed to remove assessment document from storage", storageError);
      }

      const response = await callApi(
        `/api/assessment-documents?assessment_document_id=${encodeURIComponent(document.id)}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to delete assessment document."));
      }
    },
    onMutate: (document) => {
      setDeletingAssessmentId(document.id);
    },
    onSuccess: (_, document) => {
      if (selectedAssessmentId === document.id) {
        setSelectedAssessmentId(null);
      }
      queryClient.invalidateQueries({
        queryKey: ["assessment-documents", client.id, organizationId ?? "MISSING_ORG"],
      });
      queryClient.invalidateQueries({
        queryKey: ["assessment-checklist", document.id, organizationId ?? "MISSING_ORG"],
      });
      queryClient.invalidateQueries({
        queryKey: ["assessment-drafts", document.id, organizationId ?? "MISSING_ORG"],
      });
      showSuccess(`Deleted ${document.file_name}.`);
    },
    onError: showError,
    onSettled: () => {
      setDeletingAssessmentId(null);
    },
  });

  const persistAssessmentDrafts = useMutation({
    mutationFn: async () => {
      if (!draftPlan) {
        throw new Error("Generate drafts first.");
      }
      if (!selectedAssessmentId) {
        throw new Error("Select an uploaded assessment before saving drafts.");
      }
      const response = await callApi("/api/assessment-drafts", {
        method: "POST",
        body: JSON.stringify({
          assessment_document_id: selectedAssessmentId,
          program: draftPlan.program,
          goals: draftPlan.goals,
          rationale: draftPlan.rationale ?? undefined,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to save draft program and goals to staged review.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["assessment-drafts", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
      });
      queryClient.invalidateQueries({
        queryKey: ["assessment-documents", client.id, organizationId ?? "MISSING_ORG"],
      });
      showSuccess("AI proposal saved to assessment queue for review.");
    },
    onError: showError,
  });

  const generateDraftsFromUploadedAssessment = useMutation({
    mutationFn: async () => {
      if (!selectedAssessmentId) {
        throw new Error("Select an uploaded assessment first.");
      }
      const response = await callApi("/api/assessment-drafts", {
        method: "POST",
        body: JSON.stringify({
          assessment_document_id: selectedAssessmentId,
          auto_generate: true,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to generate drafts from uploaded assessment."));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["assessment-drafts", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
      });
      queryClient.invalidateQueries({
        queryKey: ["assessment-documents", client.id, organizationId ?? "MISSING_ORG"],
      });
      showSuccess("AI proposal program and goals generated from uploaded FBA.");
    },
    onError: showError,
  });

  const updateDraftProgram = useMutation({
    mutationFn: async (programId: string) => {
      const edit = draftProgramEdits[programId];
      if (!edit) {
        throw new Error("Program edit state not found.");
      }
      const response = await callApi("/api/assessment-drafts", {
        method: "PATCH",
        body: JSON.stringify({
          draft_type: "program",
          id: programId,
          accept_state: edit.acceptState,
          review_notes: edit.reviewNotes,
          name: edit.name,
          description: edit.description,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to update draft program.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["assessment-drafts", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
      });
      showSuccess("Draft program updated.");
    },
    onError: showError,
  });

  const updateDraftGoal = useMutation({
    mutationFn: async (goalId: string) => {
      const edit = draftGoalEdits[goalId];
      if (!edit) {
        throw new Error("Goal edit state not found.");
      }
      const response = await callApi("/api/assessment-drafts", {
        method: "PATCH",
        body: JSON.stringify({
          draft_type: "goal",
          id: goalId,
          accept_state: edit.acceptState,
          review_notes: edit.reviewNotes,
          title: edit.title,
          description: edit.description,
          original_text: edit.originalText,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to update draft goal.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["assessment-drafts", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
      });
      showSuccess("Draft goal updated.");
    },
    onError: showError,
  });

  const promoteAssessment = useMutation({
    mutationFn: async () => {
      if (!selectedAssessmentId) {
        throw new Error("Select an assessment first.");
      }
      const response = await callApi("/api/assessment-promote", {
        method: "POST",
        body: JSON.stringify({ assessment_document_id: selectedAssessmentId }),
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Assessment cannot be promoted yet."));
      }
      return parseJson<{ created_goal_count: number }>(response);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["assessment-documents", client.id, organizationId ?? "MISSING_ORG"],
      });
      queryClient.invalidateQueries({
        queryKey: ["client-programs", client.id, organizationId ?? "MISSING_ORG"],
      });
      queryClient.invalidateQueries({
        queryKey: ["program-goals", resolvedProgramId, organizationId ?? "MISSING_ORG"],
      });
      showSuccess(`Published approved records. Created production program and ${result.created_goal_count} goals.`);
    },
    onError: showError,
  });

  const generateAssessmentPlanPdf = useMutation({
    mutationFn: async () => {
      if (!selectedAssessmentId) {
        throw new Error("Select an assessment first.");
      }
      const response = await callApi("/api/assessment-plan-pdf", {
        method: "POST",
        body: JSON.stringify({ assessment_document_id: selectedAssessmentId }),
      });
      const result = await parseJson<AssessmentPlanPdfResponse>(response);
      if (!response.ok) {
        throw new Error("Unable to generate completed treatment plan PDF. Ensure required checklist rows are approved.");
      }
      return result;
    },
    onSuccess: (result) => {
      if (typeof window !== "undefined" && result.signed_url) {
        window.open(result.signed_url, "_blank", "noopener,noreferrer");
      }
      const modeLabel = result.fill_mode === "acroform" ? "AcroForm" : "overlay";
      showSuccess(`Completed CalOptima PDF generated (${modeLabel} mode).`);
    },
    onError: showError,
  });

  const createProgram = useMutation({
    mutationFn: async () => {
      const response = await callApi("/api/programs", {
        method: "POST",
        body: JSON.stringify({
          client_id: client.id,
          name: programName,
          description: programDescription || undefined,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to create program");
      }
      return parseJson<Program>(response);
    },
    onSuccess: (created) => {
      showSuccess("Program created");
      setProgramName("");
      setProgramDescription("");
      setSelectedProgramId(created.id);
      queryClient.invalidateQueries({
        queryKey: ["client-programs", client.id, organizationId ?? "MISSING_ORG"],
      });
    },
    onError: showError,
  });

  const createGoal = useMutation({
    mutationFn: async () => {
      if (!resolvedProgramId) {
        throw new Error("Select a program first");
      }
      const response = await callApi("/api/goals", {
        method: "POST",
        body: JSON.stringify({
          client_id: client.id,
          program_id: resolvedProgramId,
          title: goalTitle,
          description: goalDescription,
          original_text: goalOriginalText,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to create goal");
      }
      return parseJson<Goal>(response);
    },
    onSuccess: () => {
      showSuccess("Goal created");
      setGoalTitle("");
      setGoalDescription("");
      setGoalOriginalText("");
      queryClient.invalidateQueries({
        queryKey: ["program-goals", resolvedProgramId, organizationId ?? "MISSING_ORG"],
      });
    },
    onError: showError,
  });

  const createNote = useMutation({
    mutationFn: async () => {
      if (!resolvedProgramId) {
        throw new Error("Select a program first");
      }
      const response = await callApi("/api/program-notes", {
        method: "POST",
        body: JSON.stringify({
          program_id: resolvedProgramId,
          note_type: noteType,
          content: { text: noteContent },
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to add program note");
      }
      return parseJson<ProgramNote>(response);
    },
    onSuccess: () => {
      showSuccess("Program note added");
      setNoteContent("");
      queryClient.invalidateQueries({
        queryKey: ["program-notes", resolvedProgramId, organizationId ?? "MISSING_ORG"],
      });
    },
    onError: showError,
  });

  const generateDraftPlan = useMutation({
    mutationFn: async () => {
      if (!session?.access_token) {
        throw new Error("An active login session is required to generate drafts.");
      }
      return generateProgramGoalDraft(
        assessmentInput,
        { accessToken: session.access_token },
        { clientName: client.full_name },
      );
    },
    onSuccess: (draft) => {
      setDraftPlan(draft);
      setProgramName(draft.program.name);
      setProgramDescription(draft.program.description ?? "");
      if (draft.goals[0]) {
        applyDraftGoal(draft.goals[0]);
      }
      showSuccess("Draft program and goals generated. Review and create when ready.");
    },
    onError: showError,
  });

  if (programsLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100">
        Organization context is required to manage programs and goals.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
              <UploadCloud className="w-4 h-4" />
              FBA Upload + AI Workflow
            </h3>
            <div className="space-y-3">
              <select
                value={assessmentTemplateType}
                onChange={(event) => setAssessmentTemplateType(event.target.value as AssessmentTemplateType)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              >
                <option value="caloptima_fba">CalOptima FBA</option>
                <option value="iehp_fba">IEHP FBA</option>
              </select>
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(event) => setAssessmentFile(event.target.files?.[0] ?? null)}
                className="w-full text-sm"
              />
              <button
                type="button"
                onClick={() => uploadAssessment.mutate()}
                disabled={!assessmentFile || uploadAssessment.isLoading}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {uploadAssessment.isLoading ? "Uploading..." : `Upload ${TEMPLATE_LABELS[assessmentTemplateType]}`}
              </button>
              <div className="rounded-md border border-gray-200 dark:border-gray-700 p-2 max-h-48 overflow-auto">
                {assessmentLoading ? (
                  <p className="text-xs text-gray-500">Loading assessment queue...</p>
                ) : assessmentDocuments.length === 0 ? (
                  <p className="text-xs text-gray-500">No uploaded assessments yet.</p>
                ) : (
                  <div className="space-y-2">
                    {assessmentDocuments.map((doc) => (
                      <div
                        key={doc.id}
                        className={`w-full rounded border text-xs ${
                          selectedAssessmentId === doc.id
                            ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
                            : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
                        }`}
                      >
                        <button type="button" onClick={() => setSelectedAssessmentId(doc.id)} className="w-full text-left px-2 pt-2">
                          <div className="font-medium">{doc.file_name}</div>
                          <div className="mt-1 flex items-center gap-1 text-[11px] opacity-90">
                            <span>{TEMPLATE_LABELS[doc.template_type]} •</span>
                            <span className={`rounded px-1.5 py-0.5 font-semibold ${statusToneByAssessment[doc.status].className}`}>
                              {statusToneByAssessment[doc.status].label}
                            </span>
                            <span>• {new Date(doc.created_at).toLocaleDateString()}</span>
                          </div>
                          {doc.status === "extraction_failed" && (
                            <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                              {doc.extraction_error ?? "Extraction failed. Review checklist manually."}
                            </div>
                          )}
                        </button>
                        <div className="px-2 pb-2 pt-1 flex justify-end">
                          <button
                            type="button"
                            aria-label={`Delete ${doc.file_name}`}
                            title={`Delete ${doc.file_name}`}
                            onClick={() => {
                              if (typeof window !== "undefined") {
                                const confirmed = window.confirm(`Delete ${doc.file_name}? This cannot be undone.`);
                                if (!confirmed) {
                                  return;
                                }
                              }
                              deleteAssessmentDocument.mutate(doc);
                            }}
                            disabled={deletingAssessmentId === doc.id && deleteAssessmentDocument.isLoading}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900/30 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {deletingAssessmentId === doc.id && deleteAssessmentDocument.isLoading ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => promoteAssessment.mutate()}
                disabled={!canPromoteAssessment || promoteAssessment.isLoading}
                title={promoteDisabledReason ?? undefined}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50"
              >
                {promoteAssessment.isLoading ? "Publishing..." : "Publish Approved Programs + Goals"}
              </button>
              {promoteDisabledReason && !promoteAssessment.isLoading && (
                <p className="text-xs text-amber-700 dark:text-amber-300">{promoteDisabledReason}</p>
              )}
              <button
                type="button"
                onClick={() => generateDraftsFromUploadedAssessment.mutate()}
                disabled={!canQuerySelectedAssessment || generateDraftsFromUploadedAssessment.isLoading}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-cyan-600 rounded-md hover:bg-cyan-700 disabled:opacity-50"
              >
                {generateDraftsFromUploadedAssessment.isLoading
                  ? "Generating AI Proposal..."
                  : "Generate with AI from Uploaded FBA"}
              </button>
              <button
                type="button"
                onClick={() => generateAssessmentPlanPdf.mutate()}
                disabled={!canQuerySelectedAssessment || generateAssessmentPlanPdf.isLoading}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-violet-600 rounded-md hover:bg-violet-700 disabled:opacity-50"
              >
                {generateAssessmentPlanPdf.isLoading ? "Generating..." : "Optional: Export Completed CalOptima PDF"}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
              Generate with AI from Manual Notes (Optional Fallback)
            </h3>
            <div className="space-y-3">
              <textarea
                value={assessmentInput}
                onChange={(event) => setAssessmentInput(event.target.value)}
                placeholder="Paste assessment summary or White Bible-aligned notes to draft a program and measurable goals."
                rows={6}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <button
                type="button"
                onClick={() => generateDraftPlan.mutate()}
                disabled={assessmentInput.trim().length < 20 || generateDraftPlan.isLoading}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {generateDraftPlan.isLoading ? "Generating..." : "Generate AI Proposal Program + Goals"}
              </button>
            </div>

            {draftPlan && (
              <div className="mt-4 space-y-3 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900 dark:border-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-100">
                <p className="font-semibold">Draft program: {draftPlan.program.name}</p>
                {draftPlan.rationale && <p>{draftPlan.rationale}</p>}
                <div className="space-y-2">
                  {draftPlan.goals.map((goal, index) => (
                    <div key={`${goal.title}-${index}`} className="rounded border border-indigo-200 bg-white px-2 py-2 dark:border-indigo-700 dark:bg-dark-lighter">
                      <p className="font-medium">{goal.title}</p>
                      <button
                        type="button"
                        onClick={() => applyDraftGoal(goal)}
                        className="mt-1 text-indigo-700 underline hover:text-indigo-900 dark:text-indigo-300 dark:hover:text-indigo-100"
                      >
                        Load into goal form
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => persistAssessmentDrafts.mutate()}
                  disabled={!canQuerySelectedAssessment || persistAssessmentDrafts.isLoading}
                  className="w-full px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {persistAssessmentDrafts.isLoading ? "Saving..." : "Save AI Proposal to Selected Assessment"}
                </button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Programs</h3>
            <div className="space-y-2">
              {programs.length === 0 && (
                <p className="text-sm text-gray-500">No programs yet.</p>
              )}
              {programs.map((program) => (
                <button
                  key={program.id}
                  type="button"
                  onClick={() => setSelectedProgramId(program.id)}
                  className={`w-full text-left rounded-md px-3 py-2 text-sm border ${
                    resolvedProgramId === program.id
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
                      : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  <div className="font-medium">{program.name}</div>
                  {program.description && (
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2">{program.description}</div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add Program
            </h3>
            <div className="space-y-3">
              <input
                type="text"
                value={programName}
                onChange={(event) => setProgramName(event.target.value)}
                placeholder="Program name"
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <textarea
                value={programDescription}
                onChange={(event) => setProgramDescription(event.target.value)}
                placeholder="Program description"
                rows={3}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <button
                type="button"
                onClick={() => createProgram.mutate()}
                disabled={!programName || createProgram.isLoading}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {createProgram.isLoading ? "Creating..." : "Create Program"}
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {ENABLE_CHECKLIST_MAPPING_UI && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
                {selectedAssessmentTemplateLabel} Checklist Review
              </h3>
              {selectedAssessmentDocument && (
                <p className="mb-3 text-xs text-gray-500 dark:text-gray-300">
                  Document status:{" "}
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${statusToneByAssessment[selectedAssessmentDocument.status].className}`}>
                    {statusToneByAssessment[selectedAssessmentDocument.status].label}
                  </span>
                  {" • "}
                  Unresolved required rows: {unresolvedRequiredCount}
                </p>
              )}
              {!selectedAssessmentId ? (
                <p className="text-sm text-gray-500">Upload and select an assessment to review checklist items.</p>
              ) : checklistBySection.length === 0 ? (
                <p className="text-sm text-gray-500">Checklist not available yet for this assessment.</p>
              ) : (
                <div className="space-y-4">
                  {checklistBySection.map(([section, rows]) => (
                    <div key={section} className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-2">
                        {section.replace(/_/g, " ")}
                      </h4>
                      <div className="space-y-3">
                        {rows.map((row) => {
                          const edit = checklistEdits[row.id] ?? {
                            status: row.status,
                            reviewNotes: row.review_notes ?? "",
                            valueText: row.value_text ?? "",
                          };
                          return (
                            <div key={row.id} className="rounded border border-gray-200 dark:border-gray-700 p-2">
                              <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{row.label}</div>
                              <div className="text-[11px] text-gray-500 mb-2">
                                {row.placeholder_key} • {row.mode} • required: {String(row.required)}
                                {row.review_notes ? ` • ${row.review_notes}` : ""}
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                <select
                                  value={edit.status}
                                  onChange={(event) =>
                                    setChecklistEdits((current) => ({
                                      ...current,
                                      [row.id]: {
                                        ...edit,
                                        status: event.target.value as AssessmentChecklistItem["status"],
                                      },
                                    }))
                                  }
                                  className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                                >
                                  <option value="not_started">not_started</option>
                                  <option value="drafted">drafted</option>
                                  <option value="verified">verified</option>
                                  <option value="approved">approved</option>
                                </select>
                                <input
                                  value={edit.reviewNotes}
                                  onChange={(event) =>
                                    setChecklistEdits((current) => ({
                                      ...current,
                                      [row.id]: {
                                        ...edit,
                                        reviewNotes: event.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="Review notes"
                                  className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                                />
                                <input
                                  value={edit.valueText}
                                  onChange={(event) =>
                                    setChecklistEdits((current) => ({
                                      ...current,
                                      [row.id]: {
                                        ...edit,
                                        valueText: event.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="Field value"
                                  className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => updateChecklistItem.mutate(row.id)}
                                disabled={updateChecklistItem.isLoading}
                                className="mt-2 px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                              >
                                Save Checklist Row
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
              AI Proposal Review (Approve / Reject / Edit)
            </h3>
            {!selectedAssessmentId ? (
              <p className="text-sm text-gray-500">Select an assessment to review its draft program and goals.</p>
            ) : (
              <div className="space-y-4">
                {(assessmentDrafts?.programs ?? []).map((program) => {
                  const edit = draftProgramEdits[program.id] ?? {
                    acceptState: program.accept_state,
                    reviewNotes: program.review_notes ?? "",
                    name: program.name,
                    description: program.description ?? "",
                  };
                  return (
                    <div key={program.id} className="rounded border border-gray-200 dark:border-gray-700 p-3">
                      <p className="text-xs font-semibold mb-2">Draft Program</p>
                      <div className="grid grid-cols-1 gap-2">
                        <input
                          value={edit.name}
                          onChange={(event) =>
                            setDraftProgramEdits((current) => ({
                              ...current,
                              [program.id]: {
                                ...edit,
                                name: event.target.value,
                              },
                            }))
                          }
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <textarea
                          value={edit.description}
                          onChange={(event) =>
                            setDraftProgramEdits((current) => ({
                              ...current,
                              [program.id]: {
                                ...edit,
                                description: event.target.value,
                              },
                            }))
                          }
                          rows={2}
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <select
                            value={edit.acceptState}
                            onChange={(event) =>
                              setDraftProgramEdits((current) => ({
                                ...current,
                                [program.id]: {
                                  ...edit,
                                  acceptState: event.target.value as AssessmentDraftProgram["accept_state"],
                                },
                              }))
                            }
                            className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                          >
                            <option value="pending">pending</option>
                            <option value="accepted">accepted</option>
                            <option value="rejected">rejected</option>
                            <option value="edited">edited</option>
                          </select>
                          <input
                            value={edit.reviewNotes}
                            onChange={(event) =>
                              setDraftProgramEdits((current) => ({
                                ...current,
                                [program.id]: {
                                  ...edit,
                                  reviewNotes: event.target.value,
                                },
                              }))
                            }
                            placeholder="Program review notes"
                            className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateDraftProgram.mutate(program.id)}
                        disabled={updateDraftProgram.isLoading}
                        className="mt-2 px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        Save Program Review
                      </button>
                    </div>
                  );
                })}

                {(assessmentDrafts?.goals ?? []).map((goal) => {
                  const edit = draftGoalEdits[goal.id] ?? {
                    acceptState: goal.accept_state,
                    reviewNotes: goal.review_notes ?? "",
                    title: goal.title,
                    description: goal.description,
                    originalText: goal.original_text,
                  };
                  return (
                    <div key={goal.id} className="rounded border border-gray-200 dark:border-gray-700 p-3">
                      <p className="text-xs font-semibold mb-2">Draft Goal</p>
                      <div className="grid grid-cols-1 gap-2">
                        <input
                          value={edit.title}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                title: event.target.value,
                              },
                            }))
                          }
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <textarea
                          value={edit.description}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                description: event.target.value,
                              },
                            }))
                          }
                          rows={2}
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <textarea
                          value={edit.originalText}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                originalText: event.target.value,
                              },
                            }))
                          }
                          rows={2}
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <select
                            value={edit.acceptState}
                            onChange={(event) =>
                              setDraftGoalEdits((current) => ({
                                ...current,
                                [goal.id]: {
                                  ...edit,
                                  acceptState: event.target.value as AssessmentDraftGoal["accept_state"],
                                },
                              }))
                            }
                            className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                          >
                            <option value="pending">pending</option>
                            <option value="accepted">accepted</option>
                            <option value="rejected">rejected</option>
                            <option value="edited">edited</option>
                          </select>
                          <input
                            value={edit.reviewNotes}
                            onChange={(event) =>
                              setDraftGoalEdits((current) => ({
                                ...current,
                                [goal.id]: {
                                  ...edit,
                                  reviewNotes: event.target.value,
                                },
                              }))
                            }
                            placeholder="Goal review notes"
                            className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateDraftGoal.mutate(goal.id)}
                        disabled={updateDraftGoal.isLoading}
                        className="mt-2 px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        Save Goal Review
                      </button>
                    </div>
                  );
                })}

                {(assessmentDrafts?.programs?.length ?? 0) === 0 && (assessmentDrafts?.goals?.length ?? 0) === 0 && (
                  <p className="text-sm text-gray-500">No staged drafts yet. Generate then save drafts to assessment.</p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              Goals
            </h3>
            {goalsLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <div className="space-y-3">
                {goals.length === 0 && (
                  <p className="text-sm text-gray-500">No goals in this program yet.</p>
                )}
                {goals.map((goal) => (
                  <div key={goal.id} className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-gray-800 dark:text-gray-200">{goal.title}</div>
                      <span className="text-xs uppercase text-gray-500">{goal.status}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{goal.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Add Goal</h3>
            <div className="space-y-3">
              <input
                type="text"
                value={goalTitle}
                onChange={(event) => setGoalTitle(event.target.value)}
                placeholder="Goal title"
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <textarea
                value={goalDescription}
                onChange={(event) => setGoalDescription(event.target.value)}
                placeholder="Goal description"
                rows={2}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <textarea
                value={goalOriginalText}
                onChange={(event) => setGoalOriginalText(event.target.value)}
                placeholder="Original clinical wording"
                rows={2}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <button
                type="button"
                onClick={() => createGoal.mutate()}
                disabled={!resolvedProgramId || !goalTitle || !goalDescription || !goalOriginalText || createGoal.isLoading}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {createGoal.isLoading ? "Creating..." : "Create Goal"}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Program Notes</h3>
            <div className="space-y-3">
              {programNotes.length === 0 && (
                <p className="text-sm text-gray-500">No program notes yet.</p>
              )}
              {programNotes.map((note) => (
                <div key={note.id} className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{note.note_type.replace("_", " ")}</span>
                    <span>{new Date(note.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-200 mt-2">
                    {typeof note.content?.text === "string" ? note.content.text : "Note saved"}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              <select
                value={noteType}
                onChange={(event) => setNoteType(event.target.value as ProgramNote["note_type"])}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              >
                <option value="plan_update">Plan Update</option>
                <option value="progress_summary">Progress Summary</option>
                <option value="other">Other</option>
              </select>
              <textarea
                value={noteContent}
                onChange={(event) => setNoteContent(event.target.value)}
                placeholder="Add a program note"
                rows={3}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <button
                type="button"
                onClick={() => createNote.mutate()}
                disabled={!resolvedProgramId || !noteContent || createNote.isLoading}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {createNote.isLoading ? "Saving..." : "Add Note"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
