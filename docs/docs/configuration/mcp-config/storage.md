# Key-value storage

Tableau MCP supports a bring-your-own implementation for key-value storage. The server ships
an in-memory implementation; deployments can supply a module backed by Redis, DynamoDB, or
another service. The same configured provider serves session state and other KV namespaces.

## Provider selection

```bash
KV_STORE_PROVIDER=custom
KV_STORE_PROVIDER_CONFIG='{"module":"./my-kv-provider.cjs","table":"mcp-state"}'
```

`KV_STORE_PROVIDER` accepts `memory` (the default) or `custom`. For `custom`,
`KV_STORE_PROVIDER_CONFIG` must be a JSON object with a string `module` field. The module may
be a path relative to the server's working directory, an absolute path, or an installed npm
package name. All configuration fields are passed to its constructor.

When `KV_STORE_PROVIDER` is set, its settings take precedence as a pair. Otherwise the existing
`SESSION_STORE_PROVIDER` and `SESSION_STORE_PROVIDER_CONFIG` settings are used. The legacy
configuration and imports remain supported; callers do not need separate provider systems.

The legacy `SessionStore` type and session-store lifecycle/factory function names are deprecated
in favor of the generic storage API. Existing aliases remain available. Server startup calls
`await connectKeyValueStore()`, which selects and constructs the configured provider when
needed, then awaits its optional `init()` hook.

Invalid KV provider settings, module-loading errors, and missing required methods fail startup.
An explicitly configured custom provider is never silently replaced with memory.

Malformed provider JSON errors identify the setting without echoing its value. Module-loading
and constructor failures use a fixed error message without the original error or module path.
Providers must also keep configuration values and credentials out of their own errors and
logs, including errors from optional lifecycle hooks.

## Provider contract

Import the public, dependency-free interface and implement it on your provider class:

```typescript
import type { KeyValueStore } from '@tableau/mcp-server/storage/keyValueStore';
```

The module must export a default class or a named `KeyValueStore` class. Existing named
`SessionStore` providers are also accepted. Implementations must support the value types of all
enabled consumers, including OAuth objects when embedded OAuth is enabled.

| Operation | Behavior |
| --- | --- |
| `get(key)` | Return the value, or `undefined` if absent. |
| `set(key, value)` | Store or replace a value. |
| `delete(key)` | Remove a value; missing keys are harmless. |
| `consume(key)` | Atomically return and delete a value, so at most one caller receives it. |

Methods return promises. Backend errors must reject. For shared backends, `consume` must be
atomic across replicas; separate read and delete requests are insufficient. Encoding and
decoding values is the provider's responsibility.

## Namespaces and expiration

Server code obtains a scoped store with `createNamespacedKeyValueStore(namespace, options)`
from `src/storage/storageProvider.ts`.
Namespaces must be non-empty strings without `:`; invalid names are rejected before provider
initialization. Custom providers receive keys prefixed with `<namespace>:`, so the namespace
is the text before the first colon. Keys may contain colons and are passed through unchanged
after that prefix. One custom provider instance is shared across namespaces. Memory stores
are independent per factory call.

Every namespace requires an explicit, finite `ttlMs` in milliseconds when it is created;
`maxSize` remains optional. Server code supplies each namespace's lifetime, so deployments do
not need to choose these values. Missing or non-finite TTLs are rejected before a store is
created. Memory stores expire entries using this TTL, and existing session callers continue
supplying their configured lifetimes.

Each `set` starts a new lifetime using the namespace TTL. Custom providers must return
`undefined` from `get` and `consume` for expired records even if the backend has not yet
deleted them. In particular, DynamoDB TTL cleanup is asynchronous, so its provider must
check expiration before returning a value. The memory provider uses `ExpiringMap` timers
for expiration; cleanup may be delayed while the event loop is blocked. It retains the
existing one-millisecond minimum for non-positive TTLs.

For compatibility, a custom provider may implement
`configureNamespace(namespace, { ttlMs, maxSize? })` to receive namespace settings. The hook
always receives a numeric TTL. The provider owns backend expiration and capacity behavior.
Repeated configuration calls with identical settings must be harmless. Callers remain
responsible for domain-specific validity checks.

Providers may also implement the existing optional `init()` and `close()` hooks for readiness
and connection cleanup. Startup awaits `init()` and fails if it rejects; shutdown awaits
`close()`. These hooks are provider infrastructure and are not part of `KeyValueStore`.
