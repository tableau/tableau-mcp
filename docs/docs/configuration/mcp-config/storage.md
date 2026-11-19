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

Providing `KV_STORE_PROVIDER_CONFIG` without `KV_STORE_PROVIDER`, or with
`KV_STORE_PROVIDER=memory`, fails startup. These settings configure generic key-value storage.
OAuth session storage has its own
[provider settings](oauth.md#session_store_provider).

The startup readiness log identifies the selected KV provider as `memory` or `custom`.
Memory storage is local to each process. Configure a custom KV provider when callers need shared
storage across replicas; SessionStore settings do not configure KV storage.

Startup awaits `initializeKeyValueStore()` to construct and validate the configured provider, then
await its optional `init()` hook before accepting requests. The getter returns that exact instance
after initialization succeeds and does not initialize it lazily. Concurrent initialization calls
share the same initialization attempt.

Invalid configuration, module-loading failures, and missing operations fail startup. An explicitly
configured custom provider is never silently replaced with memory. Malformed JSON, module-loading,
constructor, and lifecycle-hook errors do not echo configuration values. Providers must also keep
keys, values, and credentials out of their own errors and logs.

Server-generated validation errors identify missing exports and missing required methods.
These use `KeyValueStoreProviderValidationError`, a subclass of `McpToolError`. Other load-time
exceptions are sanitized, including errors from property getters.

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

Providers may also implement optional lifecycle hooks returning `void` or `Promise<void>`:

- `init()` performs backend setup or readiness checks. Throwing or rejecting fails startup; the
  provider is unavailable until initialization succeeds. Bound connection attempts with timeouts and
  release partially initialized resources before rejecting.
- `close()` releases backend resources during `SIGTERM` or `SIGINT` shutdown. Cleanup runs alongside
  SessionStore and Activity Log cleanup within the existing five-second shutdown timeout. Cleanup
  failures cause exit code 1. The server does not drain in-flight requests before calling the hook.

For example, a DynamoDB provider could check its table in `init()` and call its SDK client's
`destroy()` method in `close()`. Providers without lifecycle hooks continue to work.

Operations return promises and backend errors reject. For shared backends, `consume` must be
atomic across replicas; separate read and delete requests are insufficient. Providers own
serialization and must reject values that cannot be encoded faithfully or exceed backend limits.

## Per-write expiration

```typescript
await initializeKeyValueStore();
const store = getKeyValueStore();
await store.set('report:abc', value, { ttlMs: 60_000 });
```

Every write requires a finite `ttlMs` in milliseconds. Prefixes are chosen by callers; the KV
API has no namespace factory or `configureNamespace()` hook. Different keys in the same
instance may have different lifetimes. Overwriting a key starts a new lifetime using the new
write's TTL; reads do not extend it.

The memory implementation uses ExpiringMap timers, supports lifetimes beyond Node's timer
limit, and clamps non-positive TTLs to one millisecond. Timer cleanup can be delayed while the
event loop is blocked.

Custom providers enforce the supplied lifetime themselves. Expired data must not be returned
merely because the backing service has not physically deleted it yet.
