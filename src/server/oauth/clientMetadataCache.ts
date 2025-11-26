import { ExpiringMap } from '../../utils/expiringMap.js';
import { ClientMetadata } from './schemas.js';

const TEN_MINUTES_IN_MS = 1000 * 60 * 10;

export const clientMetadataCache = new ExpiringMap<string, ClientMetadata>({
  defaultExpirationTimeMs: TEN_MINUTES_IN_MS,
});
