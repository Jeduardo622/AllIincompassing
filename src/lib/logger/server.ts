type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const prefix = (level: LogLevel) => `[${level.toUpperCase()}]`;

const info = (message: unknown, metadata?: unknown): void => {
  // eslint-disable-next-line no-console
  console.info(prefix('info'), message, metadata ?? '');
};

const warn = (message: unknown, metadata?: unknown): void => {
  // eslint-disable-next-line no-console
  console.warn(prefix('warn'), message, metadata ?? '');
};

const error = (message: unknown, metadata?: unknown): void => {
  // eslint-disable-next-line no-console
  console.error(prefix('error'), message, metadata ?? '');
};

const debug = (message: unknown, metadata?: unknown): void => {
  // eslint-disable-next-line no-console
  console.debug(prefix('debug'), message, metadata ?? '');
};

export const serverLogger = {
  info,
  warn,
  error,
  debug,
};


