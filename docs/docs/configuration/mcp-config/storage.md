# Key-value storage

Key-value storage uses one configured provider instance per process, exposed to server code
by `getKeyValueStore()` from `src/storage/init.ts`. The server includes an in-memory
implementation and supports custom providers.

## Provider selection

```bash
KV_STORE_PROVIDER=custom
KV_STORE_PROVIDER_CONFIG='{"module":"./my-kv-provider.cjs","table":"mcp-state"}'
```

`KV_STORE_PROVIDER` accepts `memory` (the default) or `custom`. For `custom`,
`KV_STORE_PROVIDER_CONFIG` must be a JSON object with a string `module` field. The module may
be a path relative to the server's working directory, an absolute path, or an installed npm
package name. All configuration fields are passed to its constructor.

Providing `KV_STORE_PROVIDER_CONFIG` without `KV_STORE_PROVIDER` fails startup. These
settings configure generic key-value storage. OAuth session storage has its own
[provider settings](oauth.md#session_store_provider).

Startup calls `initializeKeyValueStore()` to construct and validate the configured provider.
The getter returns that exact instance and does not initialize it lazily. KV providers do not
have an `init()` hook. A provider may expose `close(): Promise<void>` for cleanup at shutdown.

Invalid configuration, module-loading failures, and missing operations fail startup. An
explicitly configured custom provider is never silently replaced with memory. Malformed JSON,
module-loading, and constructor errors do not echo configuration values. Providers must also
keep keys, values, and credentials out of their own errors and logs.

## Provider contract

Implement the public, dependency-free interface:

```typescript
import type { KeyValueStore, SetOptions } from '@tableau/mcp-server/storage/keyValueStore';
```

The module must export a default class or a named `KeyValueStore` class. It must implement:

| Operation | Behavior |
| --- | --- |
| `get(key)` | Return the value, or `undefined` if absent or expired. |
| `set(key, value, { ttlMs })` | Store or replace a value with an explicit lifetime. |
| `delete(key)` | Remove a value; missing keys are harmless. |
| `consume(key)` | Atomically return and delete a value, or `undefined` if absent or expired. |

Operations return promises and backend errors reject. For shared backends, `consume` must be
atomic across replicas; separate read and delete requests are insufficient. Providers own
serialization and must reject values that cannot be encoded faithfully or exceed backend limits.

## Per-write expiration

```typescript
initializeKeyValueStore();
const store = getKeyValueStore();
await store.set('report:abc', value, { ttlMs: 60_000 });
```

Every write requires a finite `ttlMs` in milliseconds. Prefixes are chosen by callers; the KV
API has no namespace factory or `configureNamespace()` hook. Different keys in the same
instance may have different lifetimes. Overwriting a key starts a new lifetime using the new
write's TTL; reads do not extend it.

The memory implementation uses ExpiringMap timers, supports lifetimes beyond Node's timer
limit, and clamps non-positive TTLs to one millisecond. Timer cleanup can be delayed while the
event loop is blocked. Shutdown clears stored records and timers.

Custom providers enforce the supplied lifetime themselves. Expired data must not be returned
merely because the backing service has not physically deleted it yet.
