import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ClipboardList } from "lucide-react";
import type { Client, Goal, Program, ProgramNote } from "../../types";
import { callApi } from "../../lib/api";
import { showError, showSuccess } from "../../lib/toast";
import { useActiveOrganizationId } from "../../lib/organization";

interface ProgramsGoalsTabProps {
  client: Client;
}

const parseJson = async <T,>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text) {
    return [] as unknown as T;
  }
  return JSON.parse(text) as T;
};

export default function ProgramsGoalsTab({ client }: ProgramsGoalsTabProps) {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [programName, setProgramName] = useState("");
  const [programDescription, setProgramDescription] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [goalOriginalText, setGoalOriginalText] = useState("");
  const [noteType, setNoteType] = useState<ProgramNote["note_type"]>("plan_update");
  const [noteContent, setNoteContent] = useState("");

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
