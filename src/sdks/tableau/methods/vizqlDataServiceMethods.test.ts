import { ZodiosError } from '@zodios/core';
import { Result } from 'ts-results-es';
import { describe, expect, it, vi } from 'vitest';

import VizqlDataServiceMethods from './vizqlDataServiceMethods.js';

// A minimal data source request that satisfies userHasQueryPermissionsRequestSchema.
const request = { datasource: { datasourceLuid: 'ds-1' } };

function makeMethods(): VizqlDataServiceMethods {
  return new VizqlDataServiceMethods(
    'https://tableau.example',
    { type: 'Bearer', token: 'token' },
    {},
  );
}

// Replaces the underlying Axios transport so the real Zodios alias + isErrorFromAlias run against a
// simulated VDS response. Mirrors the transport-level stubbing in viewAllData.test.ts.
function stubTransport(methods: VizqlDataServiceMethods, impl: () => Promise<unknown>): void {
  const request = vi.fn(impl);
  // @ts-expect-error - Replacing the Axios transport to simulate VDS responses.
  methods._apiClient.axios.request = request;
}

// isErrorFromAlias only recognizes an error when config.method/url match the endpoint, so the
// simulated error must carry the request config Zodios would have sent.
function axiosError(status: number, data: Record<string, unknown>): unknown {
  return {
    isAxiosError: true,
    config: { method: 'post', url: '/user-has-query-permissions' },
    response: { status, data },
  };
}

function unwrapErr<T, E>(result: Result<T, E>): E {
  if (result.isOk()) {
    throw new Error(`Expected Err but got Ok: ${JSON.stringify(result.value)}`);
  }
  return result.error;
}

describe('VizqlDataServiceMethods.userHasQueryPermissions', () => {
  it('returns Ok with the API result when the user has permission', async () => {
    const methods = makeMethods();
    stubTransport(methods, () =>
      Promise.resolve({ data: { hasQueryPermission: true }, status: 200, headers: {}, config: {} }),
    );

    const result = await methods.userHasQueryPermissions(request);

    expect(result.unwrap()).toEqual({ hasQueryPermission: true });
  });

  it('classifies a missing endpoint (404 / 404950) as systemic feature-disabled', async () => {
    // Older servers have no user-has-query-permissions endpoint. VDS is unusable for this
    // request regardless of the data source, so this is systemic, not per-data-source.
    const methods = makeMethods();
    stubTransport(methods, () =>
      Promise.reject(
        axiosError(404, {
          errorCode: '404950',
          message: 'No endpoint POST /vizql-data-service/v1/user-has-query-permissions.',
        }),
      ),
    );

    expect(unwrapErr(await methods.userHasQueryPermissions(request))).toEqual({
      type: 'feature-disabled',
    });
  });

  it('classifies a disabled feature (403 / "feature is not enabled") as systemic feature-disabled', async () => {
    // 403800 is overloaded: it signals both a disabled feature and a per-data-source denial,
    // distinguished only by the message. A disabled feature applies to every data source.
    const methods = makeMethods();
    stubTransport(methods, () =>
      Promise.reject(
        axiosError(403, {
          errorCode: '403800',
          message: 'The VDSForWorkbookDatasources feature is not enabled.',
        }),
      ),
    );

    expect(unwrapErr(await methods.userHasQueryPermissions(request))).toEqual({
      type: 'feature-disabled',
    });
  });

  it('classifies a per-data-source denial (403 / 403800) as an api-error', async () => {
    // Same 403800 code as the disabled-feature case, but the message shows it is scoped to a
    // single data source, so it must not be treated as systemic.
    const methods = makeMethods();
    stubTransport(methods, () =>
      Promise.reject(
        axiosError(403, {
          errorCode: '403800',
          message:
            'The user does not have permission to view query permissions for data source emb-luid-1.',
        }),
      ),
    );

    expect(unwrapErr(await methods.userHasQueryPermissions(request))).toEqual({
      type: 'api-error',
      message:
        'The user does not have permission to view query permissions for data source emb-luid-1.',
      httpStatus: 403,
      errorCode: '403800',
    });
  });

  it('classifies a not-found data source (404 / 404937) as a per-data-source api-error', async () => {
    // A 404 that is NOT the missing-endpoint code is scoped to the requested data source and
    // must not be conflated with the systemic missing-endpoint case.
    const methods = makeMethods();
    stubTransport(methods, () =>
      Promise.reject(axiosError(404, { errorCode: '404937', message: 'Datasource not found.' })),
    );

    expect(unwrapErr(await methods.userHasQueryPermissions(request))).toEqual({
      type: 'api-error',
      message: 'Datasource not found.',
      httpStatus: 404,
      errorCode: '404937',
    });
  });

  it('classifies an authentication failure (401) as an api-error', async () => {
    const methods = makeMethods();
    stubTransport(methods, () =>
      Promise.reject(
        axiosError(401, { errorCode: '401002', message: 'Invalid authentication credentials.' }),
      ),
    );

    expect(unwrapErr(await methods.userHasQueryPermissions(request))).toEqual({
      type: 'api-error',
      message: 'Invalid authentication credentials.',
      httpStatus: 401,
      errorCode: '401002',
    });
  });

  it('does not treat a 403 without the "not enabled" message as feature-disabled', async () => {
    // Missing/blank message must fall through to api-error rather than being misread as a
    // systemic disabled-feature verdict.
    const methods = makeMethods();
    stubTransport(methods, () => Promise.reject(axiosError(403, { errorCode: '403800' })));

    expect(unwrapErr(await methods.userHasQueryPermissions(request))).toEqual({
      type: 'api-error',
      message: 'Unknown Tableau error',
      httpStatus: 403,
      errorCode: '403800',
    });
  });

  it('returns a zodios-error when the client throws a ZodiosError (e.g. schema validation)', async () => {
    const zodiosError = new ZodiosError('response validation failed');
    const methods = makeMethods();
    stubTransport(methods, () => Promise.reject(zodiosError));

    const error = unwrapErr(await methods.userHasQueryPermissions(request));
    expect(error).toEqual({ type: 'zodios-error', error: zodiosError });
  });

  it('rethrows errors that are neither Tableau API errors nor zodios errors', async () => {
    const methods = makeMethods();
    stubTransport(methods, () => Promise.reject(new Error('network down')));

    await expect(methods.userHasQueryPermissions(request)).rejects.toThrow('network down');
  });
});
