import { ZodiosEndpointDefinitions } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { buildRestPath } from '../../routeSafety/core.js';
import { createGuardedZodios } from '../../routeSafety/zodios.js';
import { RestApiCredentials } from '../restApi.js';
import {
  CabuConversationRequest,
  CabuConversationResponse,
  cabuConversationResponseSchema,
  CabuUtteranceRequest,
  CabuUtteranceResponse,
  cabuUtteranceResponseSchema,
} from '../types/cabu.js';
import AuthenticatedMethods from './authenticatedMethods.js';
import { CabuStreamResult, drainSseStream } from './cabuStream.js';

// CABU's `/stream` endpoint is guarded by `StreamEndpointFilter`, which requires a `Cookie:
// XSRF-TOKEN=...` paired with a matching `X-XSRF-TOKEN` header. The filter checks the two match
// each other, not any particular value, so this is a fixed double-submit token, not a secret.
const XSRF_TOKEN_VALUE = 'tableau-mcp';

// Every CABU call below is a plain POST/GET with no further benefit from a typed Zodios alias
// (the stream GET needs a raw streaming response) -- see `datasourcesMethods.ts`'s
// `publishDatasource` / `viewsMethods.ts`'s `getViewData` for the established precedent of giving
// a raw-only method zero entries in its `apis/*.ts` file, taken here to its limit: with no method
// using the typed alias path, there is nothing to declare, so there is no separate
// `apis/cabuApi.ts` file.
const cabuApis = [] as const satisfies ZodiosEndpointDefinitions;

/**
 * CABU (Tableau Agent dashboard/datasource Q&A) methods of the CES REST API.
 *
 * Conversation context (CES's server-minted `cabuCtx` cookie) is carried entirely server-side via
 * CES's Redis-backed `RoutingConversationContextStore`, keyed by `conversationId` -- confirmed by
 * the Phase 0 spike (fresh PAT sign-in per call, no cookie ever replayed, turn 2 still correctly
 * answered a question dependent on turn 1's context). So no cookie is captured, stored, or
 * replayed by this class or its callers; `conversationId` alone is sufficient.
 *
 * @export
 * @class CabuMethods
 */
export default class CabuMethods extends AuthenticatedMethods<typeof cabuApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(createGuardedZodios(baseUrl, cabuApis, { axiosConfig }), creds);
  }

  /** Starts a CABU conversation and returns the server's `conversationId` plus the datasource entries it resolved. */
  startConversation = async (body: CabuConversationRequest): Promise<CabuConversationResponse> => {
    const response = await this._apiClient.axios.post(buildRestPath('conversations'), body, {
      headers: this.authHeader.headers,
    });

    return cabuConversationResponseSchema.parse(response.data);
  };

  /** Sends one utterance on an existing conversation and returns the `utteranceId` to pass to `streamUtterance`. */
  askUtterance = async (
    conversationId: string,
    body: CabuUtteranceRequest,
  ): Promise<CabuUtteranceResponse> => {
    const response = await this._apiClient.axios.post(
      buildRestPath('conversations', conversationId, 'utterances'),
      body,
      { headers: this.authHeader.headers },
    );

    return cabuUtteranceResponseSchema.parse(response.data);
  };

  /**
   * Opens the SSE stream for one utterance and drains it to its terminal event. Sends only the
   * constant XSRF double-submit cookie/header this endpoint's `StreamEndpointFilter` requires.
   */
  streamUtterance = async (
    conversationId: string,
    utteranceId: string,
  ): Promise<CabuStreamResult> => {
    const response = await this._apiClient.axios.get(
      buildRestPath('conversations', conversationId, 'utterances', utteranceId, 'stream'),
      {
        headers: {
          ...this.authHeader.headers,
          Cookie: `XSRF-TOKEN=${XSRF_TOKEN_VALUE}`,
          'X-XSRF-TOKEN': XSRF_TOKEN_VALUE,
        },
        responseType: 'stream',
      },
    );

    return drainSseStream(response.data);
  };
}
