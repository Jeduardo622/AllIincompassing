export type ConsoleMethodName = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface GuardPattern {
  label: string;
  expression: RegExp;
  description?: string;
}

export interface ConsoleGuard {
  getCapturedLogs(method?: ConsoleMethodName): string[];
  resetCapturedLogs(): void;
  restore(): void;
  getPatterns(): GuardPattern[];
  addPatterns(...patterns: GuardPattern[]): void;
}

export interface ConsoleGuardOptions {
  patterns?: GuardPattern[];
  passthrough?: boolean;
}

const DEFAULT_PATTERNS: GuardPattern[] = [
  {
    label: 'email address',
    expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    description: 'Standard RFC5322-like emails'
  },
  {
    label: 'US phone number',
    expression: /\b(?:\+?1[-.\s]*)?(?:\(\d{3}\)|\d{3})[-.\s]*\d{3}[-.\s]*\d{4}\b/,
    description: 'North American phone numbers with optional country code'
  },
  {
    label: 'medical record number',
    expression: /\b(?:mrn|medical\s*record\s*number)\s*(?:[#:=]\s*)?(?!\*{2,})(?=[A-Z0-9-]*\d)[A-Z0-9-]{4,}\b/i,
    description: 'MRN tokens that are not already redacted'
  },
  {
    label: 'ICD-10 diagnosis code',
    expression: /\b[ABDEFGHJKLMNPRSTVWXYZ]\d{2}(?:\.\d{1,4})?\b/i,
    description: 'ICD-10 style diagnosis identifiers (e.g., F84.0)'
  },
  {
    label: 'US social security number',
    expression: /\b\d{3}-\d{2}-\d{4}\b/,
    description: 'SSA formatted identifiers'
  }
];

const METHOD_NAMES: ConsoleMethodName[] = ['log', 'info', 'warn', 'error', 'debug'];

const clonePattern = (pattern: GuardPattern): GuardPattern => ({
  label: pattern.label,
  expression: new RegExp(pattern.expression.source, pattern.expression.flags),
  description: pattern.description
});

const maskRedactedValues = (value: string): string => value.replace(/\*{4,}/g, 'MASK');

const buildSerializer = () => {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'function') {
      return `[Function ${value.name || 'anonymous'}]`;
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value as object)) {
        return '[Circular]';
      }
      seen.add(value as object);
    }
    return value;
  };
};

const safeSerialize = (input: unknown): string => {
  if (input === null || input === undefined) {
    return '';
  }
  if (typeof input === 'string') {
    return input;
  }
  if (typeof input === 'number' || typeof input === 'boolean' || typeof input === 'bigint') {
    return String(input);
  }
  if (typeof input === 'symbol') {
    return input.toString();
  }
  if (input instanceof Error) {
    const message = input.message ?? input.toString();
    const stack = typeof input.stack === 'string' ? `\n${input.stack}` : '';
    return `${input.name}: ${message}${stack}`;
  }
  try {
    return JSON.stringify(input, buildSerializer(), 2);
  } catch (error) {
    return `[unserializable:${(error as Error)?.message ?? String(error)}]`;
  }
};

const findPhiPattern = (payload: string, patterns: GuardPattern[]): GuardPattern | undefined => {
  const candidate = maskRedactedValues(payload);
  return patterns.find((pattern) => pattern.expression.test(candidate));
};

interface InternalConsoleGuard extends ConsoleGuard {
  patterns: GuardPattern[];
  passthrough: boolean;
  originals: Map<ConsoleMethodName, Console[ConsoleMethodName]>;
  captured: Map<ConsoleMethodName, string[]>;
}

let activeGuard: InternalConsoleGuard | undefined;

const installGuardImplementation = (options?: ConsoleGuardOptions): InternalConsoleGuard => {
  const patterns = (options?.patterns ?? DEFAULT_PATTERNS).map(clonePattern);
  const originals = new Map<ConsoleMethodName, Console[ConsoleMethodName]>();
  const captured = new Map<ConsoleMethodName, string[]>(
    METHOD_NAMES.map((method) => [method, []])
  );
  const passthrough = options?.passthrough ?? false;

  const guardedCall = (method: ConsoleMethodName, ...args: unknown[]): void => {
    const serialized = args.map((value) => safeSerialize(value)).join(' ');
    const violation = findPhiPattern(serialized, patterns);

    if (violation) {
      throw new Error(`ConsoleGuard detected potential ${violation.label} in console output: ${serialized}`);
    }

    captured.get(method)?.push(serialized);

    if (passthrough) {
      originals.get(method)?.apply(console, args as never);
    }
  };

  METHOD_NAMES.forEach((method) => {
    originals.set(method, console[method].bind(console));
    Object.defineProperty(console, method, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => guardedCall(method, ...args)
    });
  });

  return {
    patterns,
    passthrough,
    originals,
    captured,
    getCapturedLogs: (method?: ConsoleMethodName) => {
      if (method) {
        return [...(captured.get(method) ?? [])];
      }
      return METHOD_NAMES.flatMap((name) => captured.get(name) ?? []);
    },
    resetCapturedLogs: () => {
      METHOD_NAMES.forEach((name) => {
        captured.set(name, []);
      });
    },
    restore: () => {
      METHOD_NAMES.forEach((method) => {
        const original = originals.get(method);
        if (original) {
          Object.defineProperty(console, method, {
            configurable: true,
            writable: true,
            value: original
          });
        }
      });
      METHOD_NAMES.forEach((name) => captured.set(name, []));
      activeGuard = undefined;
    },
    getPatterns: () => patterns.map(clonePattern),
    addPatterns: (...additional: GuardPattern[]) => {
      additional.forEach((pattern) => {
        patterns.push(clonePattern(pattern));
      });
    }
  };
};

export const installConsoleGuard = (options?: ConsoleGuardOptions): ConsoleGuard => {
  if (activeGuard) {
    return activeGuard;
  }
  activeGuard = installGuardImplementation(options);
  return activeGuard;
};

export const getConsoleGuard = (): ConsoleGuard => {
  if (!activeGuard) {
    throw new Error('Console guard has not been installed. Ensure installConsoleGuard() runs in setup.');
  }
  return activeGuard;
};

export const DEFAULT_CONSOLE_GUARD_PATTERNS = DEFAULT_PATTERNS.map(clonePattern);
