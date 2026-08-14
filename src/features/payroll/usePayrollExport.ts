import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createOrReusePayrollExport,
  downloadPayrollExportCsv,
} from "./exportApi";
import type { PayrollScope } from "./api";
import { payrollAdministrationQueryKey } from "./usePayrollAdministration";

export function usePayrollExport(
  scope: PayrollScope,
) {
  const queryClient = useQueryClient();
  const administrationKey = payrollAdministrationQueryKey(scope.organizationId, scope.userId, scope.localDate);

  const createPayrollExportMutation = useMutation({
    mutationFn: createOrReusePayrollExport,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: administrationKey }),
    networkMode: "always",
  });

  const downloadPayrollExportMutation = useMutation({
    mutationFn: async ({ runId }: { runId: string }) => downloadPayrollExportCsv(runId),
    networkMode: "always",
  });

  return {
    createPayrollExportMutation,
    downloadPayrollExportMutation,
  };
}
