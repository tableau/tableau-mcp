import { ExpiringKeyValueMap } from '../utils/expiringKeyValueMap.js';
import type { KeyValueStore } from './keyValueStore.js';

/** In-memory KV implementation with required per-write expiration. */
export class InMemoryKeyValueStore<V> extends ExpiringKeyValueMap<V> implements KeyValueStore<V> {}
