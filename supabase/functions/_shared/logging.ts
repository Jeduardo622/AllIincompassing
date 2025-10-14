type LoggerFields = {
  requestId: string;
  functionName: string;
  userId?: string | null;
  orgId?: string | null;
};

type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
  with(extra: Partial<LoggerFields>): Logger;
}

function emit(level: LogLevel, fields: LoggerFields, message: string, extra?: Record<string, unknown>) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...extra,
    requestId: fields.requestId,
    functionName: fields.functionName,
    userId: fields.userId ?? undefined,
    orgId: fields.orgId ?? undefined,
  };

  const serialized = JSON.stringify(payload);
  if (level === "warn") {
    console.warn(serialized);
  } else if (level === "error") {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

export function getLogger(
  req: Request,
  initial: Partial<LoggerFields> & { functionName: string },
): Logger {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const base: LoggerFields = {
    requestId,
    functionName: initial.functionName,
    userId: initial.userId ?? null,
    orgId: initial.orgId ?? null,
  };

  const create = (fields: LoggerFields): Logger => ({
    info: (message, extra) => emit("info", fields, message, extra),
    warn: (message, extra) => emit("warn", fields, message, extra),
    error: (message, extra) => emit("error", fields, message, extra),
    with: extra => create({
      ...fields,
      ...extra,
    }),
  });

  return create(base);
}
