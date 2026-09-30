import { describe, expect, it } from 'vitest';

import { McpToolError } from '../../../errors/mcpToolError.js';
import { TableauRestError } from '../../../sdks/tableau/tableauRestError.js';
import { mapCancelFlowRunError, mapFlowWriteError } from './flowWriteErrors.js';

function axiosError(
  status: number,
  tableauError?: { code?: string; summary?: string; detail?: string },
): Error {
  const err = new Error(`Request failed with status code ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number; data?: unknown };
  };
  err.isAxiosError = true;
  err.response = { status, data: tableauError ? { error: tableauError } : undefined };
  return err;
}

describe('mapFlowWriteError', () => {
  it('passes an McpToolError through unchanged', () => {
    const original = new McpToolError({ type: 'x', message: 'y', statusCode: 400 });
    expect(mapFlowWriteError(original, 'run this flow')).toBe(original);
  });

  it('surfaces the verbatim Tableau code/summary/detail on a 403, plus the actionable hint', () => {
    const result = mapFlowWriteError(
      axiosError(403, {
        code: '403149',
        summary: 'Flow run forbidden',
        detail: 'The flow parameter setting is disabled on the site.',
      }),
      'run this flow',
    );
    expect(result.statusCode).toBe(403);
    expect(result.message).toContain('Not permitted to run this flow');
    expect(result.message).toContain('Data Management');
    // Verbatim Tableau structured error preserved.
    expect(result.message).toContain('Tableau [403149]');
    expect(result.message).toContain('Flow run forbidden: The flow parameter setting is disabled');
  });

  it('surfaces structured Tableau details when Axios wraps the error in cause', () => {
    const wrapped = Object.assign(new Error('Zodios request failed'), {
      cause: axiosError(403, {
        code: '403149',
        summary: 'Flow run forbidden',
        detail: 'The flow parameter setting is disabled on the site.',
      }),
    });

    const result = mapFlowWriteError(wrapped, 'run this flow');

    expect(result.statusCode).toBe(403);
    expect(result.message).toContain('Tableau [403149]');
    expect(result.message).toContain('Flow run forbidden: The flow parameter setting is disabled');
  });

  it('maps a 404 to a not-found message and surfaces the Tableau detail', () => {
    const result = mapFlowWriteError(
      axiosError(404, { code: '404027', summary: 'Flow not found' }),
      'run this flow task',
    );
    expect(result.statusCode).toBe(404);
    expect(result.message).toContain('was not found');
    expect(result.message).toContain('Tableau [404027]: Flow not found');
  });

  it('treats 409 as a bad-request/conflict and surfaces the subcode', () => {
    const result = mapFlowWriteError(
      axiosError(409, {
        code: '409004',
        summary: 'Conflict',
        detail: 'A run for this flow is already in progress.',
      }),
      'run this flow',
    );
    expect(result.statusCode).toBe(409);
    expect(result.message).toContain('rejected as invalid');
    expect(result.message).toContain(
      'Tableau [409004]: Conflict: A run for this flow is already in progress.',
    );
  });

  it('falls back to the exception message when there is no Tableau error body', () => {
    const result = mapFlowWriteError(axiosError(403), 'run this flow task');
    expect(result.statusCode).toBe(403);
    expect(result.message).toContain('Not permitted to run this flow task');
    // No structured body → the raw axios message is used as the cause.
    expect(result.message).toContain('status code 403');
  });

  it('maps an unknown/no-status error to a 500 with the cause', () => {
    const result = mapFlowWriteError(new Error('socket hang up'), 'run this flow');
    expect(result.statusCode).toBe(500);
    expect(result.message).toContain('socket hang up');
  });
});

describe('mapCancelFlowRunError', () => {
  it('passes an McpToolError through unchanged', () => {
    const original = new McpToolError({ type: 'x', message: 'y', statusCode: 403 });
    expect(mapCancelFlowRunError(original)).toBe(original);
  });

  it('maps 403135 (already complete) to a clear, non-retryable message', () => {
    const result = mapCancelFlowRunError(
      axiosError(403, { code: '403135', summary: 'Flow run already complete' }),
    );
    expect(result.type).toBe('cancel-flow-run-already-complete');
    expect(result.statusCode).toBe(403);
    expect(result.message).toContain('already completed');
    expect(result.message).toContain('Tableau [403135]');
  });

  it('maps 403136 (cancellation disabled) to a site-setting message', () => {
    const result = mapCancelFlowRunError(
      axiosError(403, { code: '403136', summary: 'Cancel flow runs disabled' }),
    );
    expect(result.type).toBe('cancel-flow-run-disabled');
    expect(result.statusCode).toBe(403);
    expect(result.message).toContain('disabled for this site');
  });

  it('maps 403137 (forbidden) to an ownership/permission message', () => {
    const result = mapCancelFlowRunError(
      axiosError(403, { code: '403137', summary: 'User cannot cancel flow run' }),
    );
    expect(result.type).toBe('cancel-flow-run-forbidden');
    expect(result.statusCode).toBe(403);
    expect(result.message).toContain('Not permitted to cancel this flow run');
    expect(result.message).toContain('initiated the run');
  });

  it('maps a bare 403 with no subcode to the forbidden branch', () => {
    const result = mapCancelFlowRunError(axiosError(403));
    expect(result.type).toBe('cancel-flow-run-forbidden');
    expect(result.message).toContain('status code 403');
  });

  it('maps a 404 to a flow-run-not-found message', () => {
    const result = mapCancelFlowRunError(
      axiosError(404, { code: '404036', summary: 'Flow run not found' }),
    );
    expect(result.type).toBe('cancel-flow-run-not-found');
    expect(result.statusCode).toBe(404);
    expect(result.message).toContain('flow run was not found');
    expect(result.message).toContain('Tableau [404036]: Flow run not found');
  });

  it('maps an unknown/no-status error to a 500 with the cause', () => {
    const result = mapCancelFlowRunError(new Error('socket hang up'));
    expect(result.type).toBe('cancel-flow-run-failed');
    expect(result.statusCode).toBe(500);
    expect(result.message).toContain('socket hang up');
  });

  it('uses the structured Tableau code when Axios wraps the error in cause', () => {
    const wrapped = Object.assign(new Error('Zodios request failed'), {
      cause: axiosError(403, { code: '403135', summary: 'Flow run already complete' }),
    });

    const result = mapCancelFlowRunError(wrapped);

    expect(result.type).toBe('cancel-flow-run-already-complete');
    expect(result.message).toContain('Tableau [403135]');
  });

  it('maps a TableauRestError (error envelope from a 200 body) by its embedded code', () => {
    // Cancel Flow Run returns HTTP 200 with { error: { code: 403135 } } for the
    // already-complete case; the SDK normalizes it to a TableauRestError.
    const result = mapCancelFlowRunError(
      new TableauRestError({
        code: '403135',
        summary: 'Cannot cancel flow run because the run is already complete.',
        detail: "Flow run 'run-1' is complete.",
      }),
    );
    expect(result.type).toBe('cancel-flow-run-already-complete');
    expect(result.statusCode).toBe(403);
    expect(result.message).toContain('already completed');
    expect(result.message).toContain('Tableau [403135]');
  });
});
