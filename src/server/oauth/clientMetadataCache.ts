import { TEN_MINUTES_IN_MS } from '../../config.js';
import { ExpiringMap } from '../../utils/expiringMap.js';
import { ClientMetadata } from './schemas.js';

export const clientMetadataCache = new ExpiringMap<string, ClientMetadata>({
  defaultExpirationTimeMs: TEN_MINUTES_IN_MS,
});
