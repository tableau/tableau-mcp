import { randomBytes } from 'node:crypto';

import {
  createRequestStateCodec,
  type RequestStateCodec,
  type ServerContext,
} from '@modelcontextprotocol/server';

import { getConfig } from '../config.js';
import { getMutationPreviewTtlMs } from '../tools/web/_lib/evidence.js';
import { getTableauAuthInfo } from './oauth/getTableauAuthInfo.js';

let codec: RequestStateCodec | undefined;

/**
 * HMAC codec for multi-round-trip `requestState` (2026-07-28). The state round-trips through the
 * client, so it is signed and bound to the method and Tableau principal it was minted for.
 */
export function getRequestStateCodec(): RequestStateCodec {
  codec ??= createRequestStateCodec({
    // A per-process key only verifies state that comes back to the same process, so deployments
    // with more than one replica must set REQUEST_STATE_SECRET.
    key: getConfig().requestStateSecret || randomBytes(32),
    // The state is replayable until it expires, so it gets the same window as a preview token.
    ttlSeconds: Math.floor(getMutationPreviewTtlMs() / 1000),
    bind: (ctx: ServerContext) => {
      const authInfo = getTableauAuthInfo(ctx.http?.authInfo);
      return [ctx.mcpReq.method, authInfo?.siteId ?? '', authInfo?.userId ?? ''].join('\0');
    },
  });
  return codec;
}

/** The `ServerOptions.requestState` hook that verifies echoed state before any handler runs. */
export const requestStateOptions = {
  verify: (state: string, ctx: ServerContext): Promise<unknown> =>
    getRequestStateCodec().verify(state, ctx),
};

export const exportedForTesting = {
  resetCodec: (): void => {
    codec = undefined;
  },
};
