import { useEffect } from "react";

export function useCapturePendingScheduleEvent(): void {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const bufferToLocalStorage = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        localStorage.setItem("pendingSchedule", JSON.stringify(detail));
      } catch {
        // Ignore write failures.
      }
    };

    document.addEventListener("openScheduleModal", bufferToLocalStorage as EventListener, true);
    window.addEventListener("openScheduleModal", bufferToLocalStorage as EventListener, true);

    return () => {
      document.removeEventListener("openScheduleModal", bufferToLocalStorage as EventListener, true);
      window.removeEventListener("openScheduleModal", bufferToLocalStorage as EventListener, true);
    };
  }, []);
}

