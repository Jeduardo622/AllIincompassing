type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const prefix = (level: LogLevel) => `[${level.toUpperCase()}]`;

const info = (message: unknown, metadata?: unknown): void => {
  console.info(prefix('info'), message, metadata ?? '');
};

const warn = (message: unknown, metadata?: unknown): void => {
  console.warn(prefix('warn'), message, metadata ?? '');
};

const error = (message: unknown, metadata?: unknown): void => {
  console.error(prefix('error'), message, metadata ?? '');
};

const debug = (message: unknown, metadata?: unknown): void => {
  console.debug(prefix('debug'), message, metadata ?? '');
};

export const serverLogger = {
  info,
  warn,
  error,
  debug,
};


