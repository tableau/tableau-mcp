import { milliseconds } from '../../milliseconds.js';
import { ExpiringMap } from '../../utils/expiringMap.js';
import { ClientMetadata } from './schemas.js';

export const clientMetadataCache = new ExpiringMap<string, ClientMetadata>({
  defaultExpirationTimeMs: milliseconds.fromMinutes(10),
});
