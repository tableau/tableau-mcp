import { ConfirmationPreStateForbiddenError } from '../../../errors/mcpToolError.js';
import { TableauRestError } from '../../../sdks/tableau/tableauRestError.js';
import { readPreState, toPreStateReadError } from './preStateRead.js';

function axiosError(status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  });
}

const opts = { description: "this flow's recent runs", requiredScopes: ['tableau:flow_runs:read'] };

describe('readPreState', () => {
  it('returns the read result unchanged', async () => {
    await expect(readPreState(async () => 'state', opts)).resolves.toBe('state');
  });

  it.each([401, 403])('maps a %i to ConfirmationPreStateForbiddenError', async (status) => {
    const promise = readPreState(() => Promise.reject(axiosError(status)), opts);
    await expect(promise).rejects.toBeInstanceOf(ConfirmationPreStateForbiddenError);
    await expect(promise).rejects.toMatchObject({
      type: 'confirmation-pre-state-forbidden',
      statusCode: status,
      requiredScopes: ['tableau:flow_runs:read'],
    });
  });

  it.each([404, 500])('rethrows a %i unchanged', async (status) => {
    const error = axiosError(status);
    await expect(readPreState(() => Promise.reject(error), opts)).rejects.toBe(error);
  });

  it('rethrows a non-HTTP error unchanged', async () => {
    const error = new Error('network down');
    await expect(readPreState(() => Promise.reject(error), opts)).rejects.toBe(error);
  });
});

describe('toPreStateReadError', () => {
  it('recognizes a TableauRestError 403 (error envelope in a 2xx response)', () => {
    const mapped = toPreStateReadError(
      new TableauRestError({ code: '403004', summary: 'Forbidden' }),
      opts,
    );
    expect(mapped).toBeInstanceOf(ConfirmationPreStateForbiddenError);
  });

  it('keeps an already-typed pre-state error as-is (nested reads keep the innermost scope)', () => {
    const inner = new ConfirmationPreStateForbiddenError({
      description: 'inner',
      requiredScopes: ['tableau:flow_tasks:read'],
      statusCode: 403,
    });
    expect(toPreStateReadError(inner, opts)).toBe(inner);
  });
});

describe('ConfirmationPreStateForbiddenError', () => {
  it('names the scope, says nothing changed, and tells the user to reconnect', () => {
    const error = new ConfirmationPreStateForbiddenError({ ...opts, statusCode: 403 });
    expect(error.message).toBe(
      "Could not read this flow's recent runs to prepare the confirmation (requires " +
        'tableau:flow_runs:read). Nothing was changed and no confirmation token was issued. ' +
        'Reconnect Tableau to grant this scope, then run the preview again. If the scope is already ' +
        'granted, your Tableau permissions may not allow this read; if your organization limits ' +
        'Tableau access, this tool may be intentionally unavailable.',
    );
  });

  it('joins multiple scopes and pluralizes', () => {
    const error = new ConfirmationPreStateForbiddenError({
      description: 'x',
      requiredScopes: ['tableau:flow_tasks:read', 'tableau:flow_runs:read'],
      statusCode: 401,
    });
    expect(error.message).toContain(
      '(requires tableau:flow_tasks:read and tableau:flow_runs:read)',
    );
    expect(error.message).toContain('grant these scopes');
  });
});
