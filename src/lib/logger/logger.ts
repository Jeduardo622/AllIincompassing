/**
 * PHI-safe logging utilities.
 *
 * Always prefer these helpers over the native `console.*` methods so every log entry is sanitized
 * through {@link redactPhi}. Provide optional metadata via the `metadata` property to include
 * structured context and pass `error` objects when you want the shared {@link errorTracker} to
 * record the failure. All values are redacted before printing or forwarding to telemetry.
 */
import { errorTracker } from '../errorTracking';
import { redactPhi } from './redactPhi';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

type ConsoleMethod = (...args: unknown[]) => void;

export interface LogOptions {
  metadata?: unknown;
  error?: unknown;
  context?: Record<string, unknown>;
  track?: boolean;
}

const consoleMethods: Record<LogLevel, ConsoleMethod> = {
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  debug: (...args) => console.debug(...args)
};

const OPTION_KEYS = new Set(['metadata', 'error', 'context', 'track']);

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isLogOptions = (value: unknown): value is LogOptions => (
  isPlainObject(value) && Array.from(Object.keys(value)).some((key) => OPTION_KEYS.has(key))
);

const normalizeOptions = (metadataOrOptions?: unknown): LogOptions | undefined => {
  if (metadataOrOptions === undefined) {
    return undefined;
  }

  if (isLogOptions(metadataOrOptions)) {
    return metadataOrOptions;
  }

  return { metadata: metadataOrOptions };
};

const safeStringify = (value: unknown): string => {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch (error) {
    return `[unserializable:${String(error)}]`;
  }
};

const formatLogMessage = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (value instanceof Error) {
    return value.message;
  }

  return safeStringify(value);
};

const omitErrorField = (metadata: Record<string, unknown>): Record<string, unknown> => {
  if ('error' in metadata) {
    const { error: _error, ...rest } = metadata;
    return rest;
  }
  return metadata;
};

const buildSanitizedContext = (
  context: Record<string, unknown> | undefined,
  sanitizedMetadata: unknown
): Record<string, unknown> | undefined => {
  const contextRecord = isPlainObject(context)
    ? (redactPhi(context) as Record<string, unknown>)
    : undefined;

  const metadataRecord = isPlainObject(sanitizedMetadata)
    ? omitErrorField(sanitizedMetadata)
    : undefined;

  if (!metadataRecord || Object.keys(metadataRecord).length === 0) {
    return contextRecord;
  }

  if (!contextRecord) {
    return { metadata: metadataRecord };
  }

  const existingMetadata = isPlainObject((contextRecord as Record<string, unknown>).metadata)
    ? (contextRecord as Record<string, unknown>).metadata
    : undefined;

  return {
    ...contextRecord,
    metadata: {
      ...(existingMetadata ?? {}),
      ...metadataRecord
    }
  };
};

const extractError = (options?: LogOptions): Error | undefined => {
  if (!options) {
    return undefined;
  }

  if (options.error instanceof Error) {
    return options.error;
  }

  if (isPlainObject(options.metadata) && options.metadata.error instanceof Error) {
    return options.metadata.error;
  }

  return undefined;
};

const sanitizeErrorForTracking = (error: Error): Error => {
  const sanitizedMessage = redactPhi(error.message) as string;
  const sanitizedStack = typeof error.stack === 'string'
    ? (redactPhi(error.stack) as string)
    : undefined;

  const sanitizedError = new Error(sanitizedMessage);
  sanitizedError.name = error.name;

  if (sanitizedStack) {
    sanitizedError.stack = sanitizedStack;
  }

  return sanitizedError;
};

const handleErrorTracking = (
  level: LogLevel,
  message: string,
  options: LogOptions | undefined,
  sanitizedMetadata: unknown
): void => {
  if (level !== 'error') {
    return;
  }

  const shouldTrack = options?.track ?? true;

  if (!shouldTrack) {
    return;
  }

  const errorToTrack = extractError(options);
  const sanitizedContext = buildSanitizedContext(options?.context, sanitizedMetadata);

  if (errorToTrack) {
    errorTracker.trackError(sanitizeErrorForTracking(errorToTrack), sanitizedContext);
    return;
  }

  if (sanitizedContext) {
    errorTracker.trackError(new Error(message), sanitizedContext);
    return;
  }

  errorTracker.trackError(new Error(message));
};

const log = (level: LogLevel, message: unknown, metadataOrOptions?: unknown): void => {
  const options = normalizeOptions(metadataOrOptions);
  const sanitizedMessage = redactPhi(message);
  const formattedMessage = formatLogMessage(sanitizedMessage);
  const sanitizedMetadata = options?.metadata !== undefined ? redactPhi(options.metadata) : undefined;
  const consoleFn = consoleMethods[level];

  if (sanitizedMetadata !== undefined) {
    consoleFn(`[${level.toUpperCase()}] ${formattedMessage}`, sanitizedMetadata);
  } else {
    consoleFn(`[${level.toUpperCase()}] ${formattedMessage}`);
  }

  handleErrorTracking(level, formattedMessage, options, sanitizedMetadata);
};

const info = (message: unknown, metadataOrOptions?: unknown): void => {
  log('info', message, metadataOrOptions);
};

const warn = (message: unknown, metadataOrOptions?: unknown): void => {
  log('warn', message, metadataOrOptions);
};

const error = (message: unknown, metadataOrOptions?: unknown): void => {
  log('error', message, metadataOrOptions);
};

const debug = (message: unknown, metadataOrOptions?: unknown): void => {
  log('debug', message, metadataOrOptions);
};

const logger = {
  info,
  warn,
  error,
  debug
};

export { logger, info, warn, error, debug };
