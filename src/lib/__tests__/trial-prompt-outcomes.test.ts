import { describe, expect, it } from "vitest";
import type { GoalTarget, SessionNote, TrialEvent } from "../../types";
import {
  buildPromptOutcomeModel,
  PROMPT_OUTCOME_LABELS,
} from "../trial-prompt-outcomes";

const goalId = "goal-1";
const configuredTarget: GoalTarget = {
  id: "target-1",
  organization_id: "org-1",
  client_id: "client-1",
  goal_id: goalId,
  name: "Mands for help",
  measurement_type: "correctIncorrect",
  graph_config: { defaultChart: "bar", source: "trial_events" },
  status: "active",
  sort_order: 0,
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
};

const rawPromptEvent = (
  id: string,
  sessionId: string,
  timestamp: string,
  response: TrialEvent["response"],
): TrialEvent => ({
  id,
  organization_id: "org-1",
  client_id: "client-1",
  session_id: sessionId,
  target_id: configuredTarget.id,
  goal_id: goalId,
  therapist_id: "therapist-1",
  trial_number: 1,
  response,
  prompt_type: "verbal",
  prompt_level: "partial",
  event_timestamp: timestamp,
  metadata: {},
  created_at: timestamp,
  updated_at: timestamp,
});

const legacyNote = (
  id: string,
  date: string,
  promptCounts: Array<{
    prompt_type: "verbal" | "gesture" | "model" | "visual" | "physical";
    prompt_level: "full" | "partial" | null;
    correct_trials: number;
    incorrect_trials: number;
    no_response_trials?: number | null;
  }>,
): SessionNote => ({
  id,
  date,
  start_time: "09:00:00",
  end_time: "10:00:00",
  service_code: "97153",
  therapist_name: "Therapist One",
  therapist_id: "therapist-1",
  goals_addressed: ["Increase functional communication"],
  goal_ids: [goalId],
  goal_notes: null,
  goal_measurements: {
    [goalId]: {
      version: 1,
      data: {
        measurement_type: "correctIncorrect",
        targets: [configuredTarget.name],
        target_trials: [
          {
            target: configuredTarget.name,
            prompt_counts: promptCounts,
          },
        ],
      },
    },
  },
  session_id: id,
  narrative: "Session note",
  is_locked: false,
  client_id: "client-1",
  authorization_id: "auth-1",
  organization_id: "org-1",
});

describe("buildPromptOutcomeModel", () => {
  it("prefers raw configured prompt events over legacy prompt counts for the same session and target", () => {
    const model = buildPromptOutcomeModel({
      goalId,
      displayPeriod: "day",
      rawEvents: [
        rawPromptEvent("event-1", "session-a", "2026-07-01T18:00:00.000Z", "correct"),
        rawPromptEvent("event-2", "session-a", "2026-07-01T18:01:00.000Z", "noResponse"),
      ],
      sessionNotes: [
        legacyNote("session-a", "2026-07-01", [
          { prompt_type: "verbal", prompt_level: "partial", correct_trials: 7, incorrect_trials: 3, no_response_trials: 2 },
        ]),
      ],
      targetLabelsById: { [configuredTarget.id]: configuredTarget.name },
    });

    expect(model.summary.total).toBe(2);
    expect(model.summary.correct).toBe(1);
    expect(model.summary.incorrect).toBe(0);
    expect(model.summary.noResponse).toBe(1);
    expect(model.evidence).toEqual([
      expect.objectContaining({
        sessionKey: "session-a",
        targetLabel: "Mands for help",
        source: "raw",
        total: 2,
      }),
    ]);
  });

  it("merges legacy prompt counts when no configured prompt events exist and buckets them by week", () => {
    const model = buildPromptOutcomeModel({
      goalId,
      displayPeriod: "week",
      rawEvents: [],
      sessionNotes: [
        legacyNote("session-a", "2026-07-01", [
          { prompt_type: "verbal", prompt_level: "partial", correct_trials: 2, incorrect_trials: 1, no_response_trials: 1 },
        ]),
        legacyNote("session-b", "2026-07-03", [
          { prompt_type: "model", prompt_level: "full", correct_trials: 1, incorrect_trials: 2, no_response_trials: 0 },
        ]),
      ],
      targetLabelsById: { [configuredTarget.id]: configuredTarget.name },
    });

    expect(model.buckets).toEqual([
      expect.objectContaining({
        key: "2026-06-29",
        label: "Week of Jun 29",
        total: 7,
        correct: 3,
        incorrect: 3,
        noResponse: 1,
      }),
    ]);
    expect(model.buckets[0].segments.map((segment) => segment.label)).toEqual([
      PROMPT_OUTCOME_LABELS.correct,
      PROMPT_OUTCOME_LABELS.incorrect,
      PROMPT_OUTCOME_LABELS.noResponse,
    ]);
  });

  it("keeps legacy prompt counts for unmatched targets even when another configured target has raw events", () => {
    const model = buildPromptOutcomeModel({
      goalId,
      displayPeriod: "day",
      rawEvents: [
        rawPromptEvent("event-1", "session-a", "2026-07-01T18:00:00.000Z", "correct"),
      ],
      sessionNotes: [
        {
          ...legacyNote("session-a", "2026-07-01", [
            { prompt_type: "verbal", prompt_level: "partial", correct_trials: 2, incorrect_trials: 0, no_response_trials: 0 },
          ]),
          goal_measurements: {
            [goalId]: {
              version: 1,
              data: {
                measurement_type: "correctIncorrect",
                targets: [configuredTarget.name, "Cross street safely"],
                target_trials: [
                  { target: configuredTarget.name },
                  {
                    target: "Cross street safely",
                    prompt_counts: [
                      { prompt_type: "gesture", prompt_level: "full", correct_trials: 0, incorrect_trials: 1, no_response_trials: 1 },
                    ],
                  },
                ],
              },
            },
          },
        },
      ],
      targetLabelsById: { [configuredTarget.id]: configuredTarget.name },
    });

    expect(model.summary).toMatchObject({ correct: 1, incorrect: 1, noResponse: 1, total: 3 });
    expect(model.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "raw", targetLabel: "Mands for help", total: 1 }),
        expect.objectContaining({ source: "legacy", targetLabel: "Cross street safely", total: 2 }),
      ]),
    );
  });

  it("drops raw prompt events that do not belong to a loaded session note", () => {
    const model = buildPromptOutcomeModel({
      goalId,
      displayPeriod: "day",
      rawEvents: [
        rawPromptEvent("event-1", "missing-session", "2026-07-01T18:00:00.000Z", "correct"),
      ],
      sessionNotes: [],
      targetLabelsById: { [configuredTarget.id]: configuredTarget.name },
      requireSessionMembership: true,
    });

    expect(model.summary.total).toBe(0);
    expect(model.evidence).toEqual([]);
    expect(model.buckets).toEqual([]);
  });

  it("keeps raw prompt events when session membership is not required", () => {
    const model = buildPromptOutcomeModel({
      goalId,
      displayPeriod: "day",
      rawEvents: [
        rawPromptEvent("event-1", "missing-session", "2026-07-01T18:00:00.000Z", "correct"),
      ],
      sessionNotes: [],
      targetLabelsById: { [configuredTarget.id]: configuredTarget.name },
    });

    expect(model.summary.total).toBe(1);
    expect(model.evidence).toEqual([
      expect.objectContaining({
        sessionKey: "missing-session",
        source: "raw",
        total: 1,
      }),
    ]);
  });

  it("keeps rows without prompt_type when the raw source is already prompt-only", () => {
    const { prompt_type: _promptType, ...promptOutcomeEvent } = rawPromptEvent(
      "event-1",
      "session-1",
      "2026-07-01T18:00:00.000Z",
      "correct",
    );
    const model = buildPromptOutcomeModel({
      goalId,
      displayPeriod: "day",
      rawEvents: [promptOutcomeEvent],
      sessionNotes: [],
      targetLabelsById: { [configuredTarget.id]: configuredTarget.name },
      rawEventsArePromptOnly: true,
    });

    expect(model.summary).toMatchObject({ correct: 1, total: 1 });
    expect(model.evidence).toEqual([
      expect.objectContaining({ sessionKey: "session-1", source: "raw", total: 1 }),
    ]);
  });
});
