import { describe, expect, it } from 'vitest';
import { describePostgrestError, isMissingRpcFunctionError } from '../isMissingRpcFunctionError';

describe('isMissingRpcFunctionError', () => {
  it('detects missing RPC by status', () => {
    const error = { status: 404, message: 'Not Found' };
    expect(isMissingRpcFunctionError(error, 'create_client')).toBe(true);
  });

  it('detects missing RPC by code', () => {
    const error = { code: 'PGRST301', message: 'Function not found' };
    expect(isMissingRpcFunctionError(error, 'create_client')).toBe(true);
  });

  it('detects missing RPC by message', () => {
    const error = { message: 'Could not find function public.create_client' };
    expect(isMissingRpcFunctionError(error, 'create_client')).toBe(true);
  });

  it('ignores unrelated errors', () => {
    const error = { code: '23505', message: 'duplicate key value violates unique constraint' };
    expect(isMissingRpcFunctionError(error, 'create_client')).toBe(false);
  });
});

describe('describePostgrestError', () => {
  it('formats error with code and details', () => {
    const error = { code: 'PGRST301', message: 'Function not found', details: 'create client first' };
    expect(describePostgrestError(error)).toBe('[PGRST301] Function not found (create client first)');
  });

  it('handles unknown errors gracefully', () => {
    expect(describePostgrestError(null)).toBe('Unknown PostgREST error');
  });
});
