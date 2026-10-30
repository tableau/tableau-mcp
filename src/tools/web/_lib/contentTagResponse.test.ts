import { ZodiosError } from '@zodios/core';
import { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { McpToolError } from '../../../errors/mcpToolError.js';
import { RouteSafetyError } from '../../../sdks/routeSafety/core.js';
import WorkbooksMethods from '../../../sdks/tableau/methods/workbooksMethods.js';
import { withContentTagResponseValidation } from './contentTagResponse.js';

const SENTINEL = 'SYNTHETIC_REJECTED_METADATA_SENTINEL';

describe('content tag response boundary', () => {
  it('contains an actual guarded SDK malformed-response message before the client error funnel', async () => {
    const methods = new WorkbooksMethods(
      'https://tableau.example/api/3.29',
      { type: 'Bearer', token: 'synthetic-test-token' },
      {
        adapter: async (config: InternalAxiosRequestConfig) => ({
          data: { privateMetadata: SENTINEL },
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          config,
        }),
      },
    );
    const read = async (): Promise<unknown> =>
      await methods.queryWorkbooksForSite({ siteId: 'site-id', filter: '' });
    await expect(read()).rejects.toBeInstanceOf(ZodiosError);
    await expect(read()).rejects.toThrow(SENTINEL);
    const result = await withContentTagResponseValidation(read);
    expect(result.isErr()).toBe(true);
    const error = result.unwrapErr();
    expect(error).toBeInstanceOf(McpToolError);
    expect(error).toMatchObject({ type: 'invalid-content-response', statusCode: 502 });
    expect(error.getErrorText()).toBe(
      'Tableau returned an invalid content response. Tag search results could not be verified.',
    );
    expect(error.message).not.toContain(SENTINEL);
  });

  it('marks mutation outcome as uncertain without returning raw validation payloads', async () => {
    const callback = vi.fn().mockRejectedValue(new ZodiosError(`Invalid response ${SENTINEL}`));
    const result = await withContentTagResponseValidation(callback, true);
    expect(result.isErr()).toBe(true);
    const error = result.unwrapErr();
    expect(error).toMatchObject({ type: 'tag-mutation-result-unverified', statusCode: 502 });
    expect(error.getErrorText()).toBe(
      "Tableau returned an invalid tag-mutation response. The change may already have been applied. Read the resource's tags to verify before retrying.",
    );
    expect(error.message).not.toContain(SENTINEL);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('contains an actual mutation SDK response with missing Content-Type', async () => {
    const methods = new WorkbooksMethods(
      'https://tableau.example/api/3.29',
      { type: 'Bearer', token: 'synthetic-test-token' },
      {
        adapter: async (config: InternalAxiosRequestConfig) => ({
          data: { privateMetadata: SENTINEL },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }),
      },
    );
    const result = await withContentTagResponseValidation(
      async () =>
        await methods.addTagsToWorkbook({
          siteId: 'site-id',
          workbookId: '22222222-2222-4222-8222-222222222222',
          tagLabels: ['safe'],
        }),
      true,
    );
    expect(result.isErr()).toBe(true);
    const error = result.unwrapErr();
    expect(error).toMatchObject({ type: 'tag-mutation-result-unverified' });
    expect(error.message).not.toContain(SENTINEL);
  });

  it.each([new RouteSafetyError('unsafe route'), new Error('transport failed')])(
    'preserves %s unchanged',
    async (error) => {
      await expect(
        withContentTagResponseValidation(async () => {
          throw error;
        }),
      ).rejects.toBe(error);
    },
  );

  it.each([401, 403, 404])(
    'preserves HTTP %s and wrapped auth errors unchanged',
    async (status) => {
      const axiosError = new AxiosError(`Synthetic HTTP ${status}`);
      axiosError.response = { status } as AxiosError['response'];
      const wrapped = new ZodiosError('HTTP error', undefined, undefined, axiosError);
      for (const error of [axiosError, wrapped]) {
        await expect(
          withContentTagResponseValidation(async () => {
            throw error;
          }),
        ).rejects.toBe(error);
      }
    },
  );
});
