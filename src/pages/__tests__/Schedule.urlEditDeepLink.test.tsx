import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/utils";
import { Schedule } from "../Schedule";
import type { Client, Session, Therapist } from "../../types";

const therapistFixture: Therapist = {
  id: "therapist-1",
  email: "therapist@example.com",
  full_name: "Taylor Therapist",
  specialties: [],
  max_clients: 10,
  service_type: [],
  weekly_hours_min: 0,
  weekly_hours_max: 40,
  availability_hours: {},
  created_at: "2025-01-01T00:00:00.000Z",
};

const clientFixture: Client = {
  id: "client-1",
  email: "client@example.com",
  full_name: "Casey Client",
  date_of_birth: "2015-01-01",
  insurance_info: {},
  service_preference: [],
  one_to_one_units: 0,
  supervision_units: 0,
  parent_consult_units: 0,
  assessment_units: 0,
  auth_units: 0,
  availability_hours: {},
  created_at: "2025-01-01T00:00:00.000Z",
};

const sessionFixture: Session = {
  id: "session-edit-1",
  client_id: clientFixture.id,
  therapist_id: therapistFixture.id,
  program_id: "program-1",
  goal_id: "goal-1",
  start_time: "2025-03-18T10:00:00.000Z",
  end_time: "2025-03-18T11:00:00.000Z",
  status: "scheduled",
  notes: "",
  created_at: "2025-03-18T09:00:00.000Z",
  created_by: "test-user",
  updated_at: "2025-03-18T09:00:00.000Z",
  updated_by: "test-user",
  therapist: { id: therapistFixture.id, full_name: therapistFixture.full_name },
  client: { id: clientFixture.id, full_name: clientFixture.full_name },
};

vi.mock("../../lib/organization", () => ({
  useActiveOrganizationId: () => "org-1",
}));

vi.mock("../../lib/optimizedQueries", () => ({
  useScheduleDataBatch: () => ({
    data: {
      sessions: [sessionFixture],
      therapists: [therapistFixture],
      clients: [clientFixture],
    },
    isLoading: false,
  }),
  useSessionsOptimized: () => ({
    data: [sessionFixture],
    isLoading: false,
  }),
  useDropdownData: () => ({
    data: {
      therapists: [therapistFixture],
      clients: [clientFixture],
    },
    isLoading: false,
  }),
}));

describe("Schedule URL edit deep links", () => {
  it("opens the edit session modal when a valid edit URL references an existing session", async () => {
    const expiresAtMs = Date.now() + 60_000;
    renderWithProviders(<Schedule />, {
      router: {
        initialEntries: [
          `/?scheduleModal=edit&scheduleSessionId=${sessionFixture.id}&scheduleExp=${expiresAtMs}`,
        ],
      },
    });

    await screen.findByRole("heading", { name: /Schedule/i });
    expect(await screen.findByText(/Edit Session/i)).toBeInTheDocument();
  });
});
