import {
  HARNESS_CLIENT_ID,
  HARNESS_GOAL_ID,
  HARNESS_PROGRAM_ID,
  HARNESS_TARGET_ID,
  harnessCriteria,
  harnessGoals,
  harnessProgramNotes,
  harnessPrograms,
  harnessTargets,
  harnessTrialEvents,
} from "../harness-data";
import { recordApiCall } from "../runtime";

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });

const methodFromInit = (init?: RequestInit) => (init?.method ?? "GET").toUpperCase();

export const callEdgeFunctionHttp = async (path: string, init?: RequestInit): Promise<Response> => {
  const method = methodFromInit(init);
  recordApiCall(method, path);

  if (method !== "GET") {
    return jsonResponse({ error: "responsive_harness_read_only" }, 405);
  }

  if (path === `programs?client_id=${HARNESS_CLIENT_ID}`) {
    return jsonResponse(harnessPrograms);
  }
  if (path === `goals?program_id=${HARNESS_PROGRAM_ID}`) {
    return jsonResponse(harnessGoals);
  }
  if (path === `goal-targets?goal_id=${HARNESS_GOAL_ID}`) {
    return jsonResponse(harnessTargets);
  }
  if (path === `goal-targets?action=criteria&target_id=${HARNESS_TARGET_ID}`) {
    return jsonResponse(harnessCriteria);
  }
  if (path === `goal-targets?action=transition_history&target_id=${HARNESS_TARGET_ID}`) {
    return jsonResponse([]);
  }
  if (path === `trial-events?target_id=${HARNESS_TARGET_ID}`) {
    return jsonResponse(harnessTrialEvents);
  }
  if (path === `program-notes?program_id=${HARNESS_PROGRAM_ID}`) {
    return jsonResponse(harnessProgramNotes);
  }

  return jsonResponse([]);
};

export const callApi = async (path: string, init?: RequestInit): Promise<Response> => {
  const method = methodFromInit(init);
  recordApiCall(method, path);

  if (method !== "GET") {
    return jsonResponse({ error: "responsive_harness_read_only" }, 405);
  }

  if (path.startsWith(`/api/assessment-documents?client_id=${HARNESS_CLIENT_ID}`)) {
    return jsonResponse([]);
  }
  if (path.startsWith("/api/assessment-checklist?")) {
    return jsonResponse({ items: [], structured_sections: [] });
  }
  if (path.startsWith("/api/assessment-drafts?")) {
    return jsonResponse({ programs: [], goals: [] });
  }

  return jsonResponse([]);
};
