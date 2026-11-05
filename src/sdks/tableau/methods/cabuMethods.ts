import { ZodiosEndpointDefinitions } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { buildRestPath } from '../../routeSafety/core.js';
import { createGuardedZodios } from '../../routeSafety/zodios.js';
import { RestApiCredentials } from '../restApi.js';
import {
  CabuConversationRequest,
  cabuConversationResponseSchema,
  CabuConversationResponse,
  CabuUtteranceRequest,
  cabuUtteranceResponseSchema,
  CabuUtteranceResponse,
} from '../types/cabu.js';
import { extractSetCookies, toCookieHeader } from './cabuCookies.js';
import { CabuStreamResult, drainSseStream } from './cabuStream.js';
import AuthenticatedMethods from './authenticatedMethods.js';

// CABU's `/stream` endpoint is guarded by `StreamEndpointFilter`, which requires a `Cookie:
// XSRF-TOKEN=...` paired with a matching `X-XSRF-TOKEN` header. The filter checks the two match
// each other, not any particular value, so this is a fixed double-submit token, not a secret.
const XSRF_TOKEN_VALUE = 'tableau-mcp';

// Every CABU call below needs raw response-header access (to capture the `cabuCtx` context
// cookie) or a raw streaming GET, so none of them is invoked via a typed Zodios alias -- see
// `datasourcesMethods.ts`'s `publishDatasource` / `viewsMethods.ts`'s `getViewData` for the
// established precedent of giving a raw-only method zero entries in its `apis/*.ts` file, taken
// here to its limit: with no method using the typed alias path, there is nothing to declare, so
// there is no separate `apis/cabuApi.ts` file. See `.work/specs/W-24280234-cabu-tools.md`.
const cabuApis = [] as const satisfies ZodiosEndpointDefinitions;

/**
 * CABU (Tableau Agent dashboard/datasource Q&A) methods of the CES REST API.
 *
 * @export
 * @class CabuMethods
 */
export default class CabuMethods extends AuthenticatedMethods<typeof cabuApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(createGuardedZodios(baseUrl, cabuApis, { axiosConfig }), creds);
  }

  /**
   * Starts a CABU conversation and returns the server's `conversationId` plus the datasource
   * entries it resolved, along with any `cabuCtx` context cookie(s) the server minted for this
   * conversation. Callers are responsible for persisting the returned cookies and replaying them
   * on `askUtterance`/`streamUtterance` -- see `.work/specs/W-24280234-cabu-tools.md`.
   */
  startConversation = async (
    body: CabuConversationRequest,
  ): Promise<{ response: CabuConversationResponse; cookies: Array<string> }> => {
    const response = await this._apiClient.axios.post(buildRestPath('conversations'), body, {
      headers: this.authHeader.headers,
    });

    return {
      response: cabuConversationResponseSchema.parse(response.data),
      cookies: extractSetCookies(response.headers),
    };
  };

  /**
   * Sends one utterance on an existing conversation, replaying the `cabuCtx` cookie(s) the caller
   * captured from `startConversation`/the previous `askUtterance`, and returns the `utteranceId`
   * (to pass to `streamUtterance`) plus the cookies refreshed by this call.
   */
  askUtterance = async (
    conversationId: string,
    body: CabuUtteranceRequest,
    cookies: Array<string>,
  ): Promise<{ response: CabuUtteranceResponse; cookies: Array<string> }> => {
    const cookieHeader = toCookieHeader(cookies);
    const response = await this._apiClient.axios.post(
      buildRestPath('conversations', conversationId, 'utterances'),
      body,
      {
        headers: {
          ...this.authHeader.headers,
          ...(cookieHeader === undefined ? {} : { Cookie: cookieHeader }),
        },
      },
    );

    return {
      response: cabuUtteranceResponseSchema.parse(response.data),
      cookies: extractSetCookies(response.headers),
    };
  };

  /**
   * Opens the SSE stream for one utterance and drains it to its terminal event. Replays the
   * `cabuCtx` cookie(s) alongside the constant XSRF double-submit cookie/header this endpoint's
   * `StreamEndpointFilter` requires.
   */
  streamUtterance = async (
    conversationId: string,
    utteranceId: string,
    cookies: Array<string>,
  ): Promise<CabuStreamResult> => {
    const cookieHeader = [toCookieHeader(cookies), `XSRF-TOKEN=${XSRF_TOKEN_VALUE}`]
      .filter((part): part is string => part !== undefined)
      .join('; ');

    const response = await this._apiClient.axios.get(
      buildRestPath('conversations', conversationId, 'utterances', utteranceId, 'stream'),
      {
        headers: {
          ...this.authHeader.headers,
          Cookie: cookieHeader,
          'X-XSRF-TOKEN': XSRF_TOKEN_VALUE,
        },
        responseType: 'stream',
      },
    );

    return drainSseStream(response.data);
  };
}
