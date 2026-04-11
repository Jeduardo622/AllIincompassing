import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSmartPrefetch } from "../optimizedQueries";

vi.mock("../supabase", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: { sessions: [] }, error: null })),
  },
}));

function SchedulePrefetchProbe({
  queryFn,
  organizationId,
}: {
  queryFn: (prefetch: ReturnType<typeof useSmartPrefetch>) => void;
  organizationId?: string | null;
}) {
  const prefetch = useSmartPrefetch();

  useEffect(() => {
    queryFn(prefetch);
  }, [prefetch, queryFn, organizationId]);

  return null;
}

describe("useSmartPrefetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses org-scoped schedule batch keys when prefetching adjacent schedule data", async () => {
    const queryClient = new QueryClient();
    const prefetchQuerySpy = vi
      .spyOn(queryClient, "prefetchQuery")
      .mockResolvedValue(undefined);
    const startDate = new Date("2025-07-07T00:00:00.000Z");
    const endDate = new Date("2025-07-13T23:59:59.999Z");

    render(
      <QueryClientProvider client={queryClient}>
        <SchedulePrefetchProbe
          organizationId="org-123"
          queryFn={({ prefetchScheduleRange }) => {
            void prefetchScheduleRange(startDate, endDate, {
              organizationId: "org-123",
            });
          }}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(prefetchQuerySpy).toHaveBeenCalledTimes(1);
    });

    expect(prefetchQuerySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: [
          "sessions-batch",
          "org-123",
          startDate.toISOString(),
          endDate.toISOString(),
        ],
      }),
    );
  });

  it("skips schedule prefetch when organization context is absent", async () => {
    const queryClient = new QueryClient();
    const prefetchQuerySpy = vi
      .spyOn(queryClient, "prefetchQuery")
      .mockResolvedValue(undefined);

    render(
      <QueryClientProvider client={queryClient}>
        <SchedulePrefetchProbe
          organizationId={null}
          queryFn={({ prefetchScheduleRange }) => {
            void prefetchScheduleRange(
              new Date("2025-07-07T00:00:00.000Z"),
              new Date("2025-07-13T23:59:59.999Z"),
              { organizationId: null },
            );
          }}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(prefetchQuerySpy).not.toHaveBeenCalled();
    });
  });
});
