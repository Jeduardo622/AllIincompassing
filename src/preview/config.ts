import path from 'node:path';

export type PreviewConfig = {
  readonly host: string;
  readonly port: number;
  readonly protocol: 'http' | 'https';
  readonly outDir: string;
  readonly url: string;
};

const DEFAULT_PREVIEW_HOST = '127.0.0.1';
const DEFAULT_PREVIEW_PORT = 4173;
const DEFAULT_PREVIEW_PROTOCOL: PreviewConfig['protocol'] = 'http';
const DEFAULT_OUTPUT_DIR = 'out';

const sanitizeHost = (value: string | undefined): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_PREVIEW_HOST;
  }
  return trimmed;
};

const sanitizePort = (value: string | undefined): number => {
  if (!value) {
    return DEFAULT_PREVIEW_PORT;
  }
  const numeric = Number.parseInt(value, 10);
  if (Number.isNaN(numeric) || numeric <= 0 || numeric > 65535) {
    throw new Error(`Invalid PREVIEW_PORT value: ${value}`);
  }
  return numeric;
};

const sanitizeProtocol = (value: string | undefined): PreviewConfig['protocol'] => {
  if (!value) {
    return DEFAULT_PREVIEW_PROTOCOL;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'http' || normalized === 'https') {
    return normalized;
  }
  throw new Error(`Unsupported PREVIEW_PROTOCOL value: ${value}`);
};

const sanitizeOutDir = (value: string | undefined): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_OUTPUT_DIR;
  }
  return trimmed;
};

const resolveUrl = ({
  explicitUrl,
  host,
  port,
  protocol,
}: {
  readonly explicitUrl?: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: PreviewConfig['protocol'];
}): string => {
  if (explicitUrl) {
    const normalized = explicitUrl.trim();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  }
  return `${protocol}://${host}:${port}`;
};

export const resolvePreviewConfig = (env: NodeJS.ProcessEnv): PreviewConfig => {
  const host = sanitizeHost(env.PREVIEW_HOST);
  const port = sanitizePort(env.PREVIEW_PORT);
  const protocol = sanitizeProtocol(env.PREVIEW_PROTOCOL);
  const outDir = sanitizeOutDir(env.PREVIEW_OUTPUT_DIR);
  const url = resolveUrl({ explicitUrl: env.PREVIEW_URL, host, port, protocol });

  return {
    host,
    port,
    protocol,
    outDir,
    url,
  };
};

export const describePreviewConfig = (config: PreviewConfig): string => {
  const absoluteOutDir = path.resolve(config.outDir);
  return `host=${config.host} port=${config.port} protocol=${config.protocol} outDir=${absoluteOutDir} url=${config.url}`;
};
