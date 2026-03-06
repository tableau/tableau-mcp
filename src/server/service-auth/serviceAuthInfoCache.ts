import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import { TableauServiceAuthInfo } from './schemas.js';

// Request-scoped cache storing service auth info (userId, siteLuid) resolved after signIn for PAT, direct-trust, UAT.
const serviceAuthInfoCache = new Map<RequestId, TableauServiceAuthInfo>();

export const getServiceAuthInfoFromCache = (requestId: RequestId): TableauServiceAuthInfo | undefined =>
  serviceAuthInfoCache.get(requestId);

export const setServiceAuthInfoInCache = (requestId: RequestId, info: TableauServiceAuthInfo): void => {
  serviceAuthInfoCache.set(requestId, info);
};

export const clearServiceAuthInfoFromCache = (requestId: RequestId): void => {
  serviceAuthInfoCache.delete(requestId);
};
