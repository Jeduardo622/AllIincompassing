import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { showError, showSuccess } from "../lib/toast";

type PromptVersionRow = {
  id: string;
  prompt_version: string;
  tool_version: string;
  status: string;
  is_current: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export function SuperAdminPrompts() {
  const queryClient = useQueryClient();
  const [promptVersion, setPromptVersion] = useState("");
  const [toolVersion, setToolVersion] = useState("");

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ["agent-prompt-tool-versions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_prompt_tool_versions")
        .select("id, prompt_version, tool_version, status, is_current, metadata, created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as PromptVersionRow[];
    },
  });

  const createVersion = useMutation({
    mutationFn: async () => {
      if (!promptVersion || !toolVersion) {
        throw new Error("Prompt and tool version are required.");
      }

      const { error: resetError } = await supabase
        .from("agent_prompt_tool_versions")
        .update({ is_current: false })
        .eq("is_current", true);

      if (resetError) throw resetError;

      const { data, error } = await supabase
        .from("agent_prompt_tool_versions")
        .insert({
          prompt_version: promptVersion,
          tool_version: toolVersion,
          status: "active",
          is_current: true,
          metadata: { source: "ui" },
        })
        .select()
        .single();

      if (error) throw error;
      return data as PromptVersionRow;
    },
    onSuccess: () => {
      showSuccess("Prompt version updated");
      setPromptVersion("");
      setToolVersion("");
      queryClient.invalidateQueries({ queryKey: ["agent-prompt-tool-versions"] });
    },
    onError: showError,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Prompt Management</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Review and update active prompt/tool versions for AI documentation.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Set Current Version</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="text"
            value={promptVersion}
            onChange={(event) => setPromptVersion(event.target.value)}
            placeholder="Prompt version"
            className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
          />
          <input
            type="text"
            value={toolVersion}
            onChange={(event) => setToolVersion(event.target.value)}
            placeholder="Tool version"
            className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
          />
          <button
            type="button"
            onClick={() => createVersion.mutate()}
            disabled={!promptVersion || !toolVersion || createVersion.isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {createVersion.isLoading ? "Saving..." : "Set Current"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Version History</h2>
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="space-y-3">
            {versions.map((version) => (
              <div key={version.id} className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="font-medium text-gray-800 dark:text-gray-200">
                    Prompt {version.prompt_version} · Tool {version.tool_version}
                  </div>
                  <span className={`text-xs uppercase ${version.is_current ? "text-green-600" : "text-gray-500"}`}>
                    {version.is_current ? "Current" : version.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {new Date(version.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
