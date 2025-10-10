import { describe, expect, it } from 'vitest';

import { describePreviewConfig, resolvePreviewConfig } from '../config';

describe('resolvePreviewConfig', () => {
  it('returns defaults when env vars are missing', () => {
    const config = resolvePreviewConfig({} as NodeJS.ProcessEnv);

    expect(config).toEqual({
      host: '127.0.0.1',
      port: 4173,
      protocol: 'http',
      outDir: 'out',
      url: 'http://127.0.0.1:4173',
    });
  });

  it('uses explicit preview url when provided', () => {
    const config = resolvePreviewConfig({ PREVIEW_URL: 'https://example.com/path/' } as NodeJS.ProcessEnv);

    expect(config.url).toBe('https://example.com/path');
    expect(config.host).toBe('127.0.0.1');
  });

  it('honors host, port, protocol, and output dir overrides', () => {
    const config = resolvePreviewConfig({
      PREVIEW_HOST: '0.0.0.0',
      PREVIEW_PORT: '5000',
      PREVIEW_PROTOCOL: 'https',
      PREVIEW_OUTPUT_DIR: 'preview-out',
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({
      host: '0.0.0.0',
      port: 5000,
      protocol: 'https',
      outDir: 'preview-out',
      url: 'https://0.0.0.0:5000',
    });
  });

  it('rejects invalid port values', () => {
    expect(() => resolvePreviewConfig({ PREVIEW_PORT: 'not-a-number' } as NodeJS.ProcessEnv)).toThrow(
      /Invalid PREVIEW_PORT value/,
    );
    expect(() => resolvePreviewConfig({ PREVIEW_PORT: '-1' } as NodeJS.ProcessEnv)).toThrow(/Invalid PREVIEW_PORT value/);
    expect(() => resolvePreviewConfig({ PREVIEW_PORT: '70000' } as NodeJS.ProcessEnv)).toThrow(/Invalid PREVIEW_PORT value/);
  });

  it('rejects unsupported protocol values', () => {
    expect(() => resolvePreviewConfig({ PREVIEW_PROTOCOL: 'ftp' } as NodeJS.ProcessEnv)).toThrow(
      /Unsupported PREVIEW_PROTOCOL value/,
    );
  });
});

describe('describePreviewConfig', () => {
  it('serializes configuration details with an absolute output directory', () => {
    const config = resolvePreviewConfig({ PREVIEW_OUTPUT_DIR: 'out' } as NodeJS.ProcessEnv);

    expect(describePreviewConfig(config)).toMatch(/outDir=/);
    expect(describePreviewConfig(config)).toContain('host=127.0.0.1');
  });
});
