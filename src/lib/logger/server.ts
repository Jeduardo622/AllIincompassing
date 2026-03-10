import { redactPhi } from './redactPhi';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const prefix = (level: LogLevel) => `[${level.toUpperCase()}]`;
const sanitize = (value: unknown): unknown => redactPhi(value);

const info = (message: unknown, metadata?: unknown): void => {
  console.info(prefix('info'), sanitize(message), sanitize(metadata ?? ''));
};

const warn = (message: unknown, metadata?: unknown): void => {
  console.warn(prefix('warn'), sanitize(message), sanitize(metadata ?? ''));
};

const error = (message: unknown, metadata?: unknown): void => {
  console.error(prefix('error'), sanitize(message), sanitize(metadata ?? ''));
};

const debug = (message: unknown, metadata?: unknown): void => {
  console.debug(prefix('debug'), sanitize(message), sanitize(metadata ?? ''));
};

export const serverLogger = {
  info,
  warn,
  error,
  debug,
};


