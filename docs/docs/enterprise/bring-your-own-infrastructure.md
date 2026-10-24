---
sidebar_position: 3
title: Bring Your Own Infrastructure
---

# Bring Your Own Infrastructure

A self-hosted Tableau MCP server runs on your infrastructure, so it should use your services too.
Four parts of the server are pluggable. For each one, you can point the server at a module you write
instead of the built-in behavior.

| Provider | What it does | Built-in default | Environment variable |
| --- | --- | --- | --- |
| [Blob storage](#blob-storage) | Holds large payloads and uploaded files | Unset: no storage | [`BLOB_STORAGE_PROVIDER`](../configuration/mcp-config/env-vars.md#blob_storage_provider) |
| [Session store](#session-store) | Holds OAuth state | `memory`: kept in the process | [`SESSION_STORE_PROVIDER`](../configuration/mcp-config/oauth.md#session_store_provider) |
| [Telemetry](#telemetry) | Receives metrics | `noop`: none | [`TELEMETRY_PROVIDER`](../configuration/mcp-config/env-vars.md#telemetry_provider) |
| [Feature gates](#feature-gates) | Decides which features are on | `server`: reads `features.json` | [`FEATURE_GATE_PROVIDER`](../configuration/mcp-config/env-vars.md#feature_gate_provider) |

Use a custom provider when you run more than one server instance, or when you must keep data in your
own cloud account. For example, the in-memory session store loses its state on restart and cannot be
shared between instances.

## How custom providers load

Every provider uses the same two variables. Replace `<NAME>` with `BLOB_STORAGE`,
`SESSION_STORE`, `TELEMETRY`, or `FEATURE_GATE`:

```bash
<NAME>_PROVIDER=custom
<NAME>_PROVIDER_CONFIG='{"module":"./my-provider.js"}'
```

- `<NAME>_PROVIDER_CONFIG` is a JSON object. `module` is required. Any other field you add is passed
  to your provider unchanged.
- `module` is a relative path, an absolute path, or an npm package name. A value that starts with `.`
  or `/` is a path. A relative path resolves from the server's working directory, not from the
  directory that holds the config.
- The server loads the module with `require`, so ship CommonJS JavaScript. Compile TypeScript first.
- The module must export a class as `default`, or as a named export with the provider's name (for
  example `BlobStorageProvider`). The server calls `new` on it with the parsed config object as the
  only argument.
- The server then checks that the object has the required methods. Optional methods are not checked.

Startup fails when `<NAME>_PROVIDER` is `custom` and `<NAME>_PROVIDER_CONFIG` is missing, is not valid
JSON, or has no `module` string. What happens when the module itself fails to load or does not match
the interface depends on the provider:

| Provider | When the module fails to load or is invalid |
| --- | --- |
| Blob storage | Startup fails |
| Session store | Startup fails |
| Telemetry | The server logs an error and uses `noop` |
| Feature gates | The server logs an error and uses the `server` provider |

An unrecognized value for `<NAME>_PROVIDER` is not an error for telemetry, feature gates, or the session
store. The server uses the default instead. For blob storage, any value other than `custom` is a
startup error.

The server initializes providers at startup, in this order: feature gates, blob storage, session
store. The session store must also pass its `init` check before the server reports
ready. Telemetry starts earlier, in the preload script that you run with `node -r`:

```bash
node -r ./build/telemetry/tracing.js build/index.js
```

Without that preload, telemetry stays `noop` even when `TELEMETRY_PROVIDER` is `custom`.

## Typing your provider

The npm package exports the interfaces as type-only subpaths. Import them to check your class at
compile time:

| Provider | Import path |
| --- | --- |
| Blob storage | `@tableau/mcp-server/blobStorage/blobStorageProvider` |
| Session store | `@tableau/mcp-server/sessionStore/sessionStore` |
| Telemetry | `@tableau/mcp-server/telemetry/telemetryProvider` |
| Feature gates | `@tableau/mcp-server/features/featureGateProvider` |

These paths have no runtime code. Use `import type`, and your compiled module does not need the
package at run time.

## Blob storage

Tools use blob storage to hand back large results, such as view images and exported data, as a URL
instead of inline content. It also holds files that clients upload before a tool publishes them, such
as workbooks.

With no provider set, tools return results inline or as local file paths on the server, and tools
that need staged uploads return a "not configured" error. There is no `noop` value. Leave the
variable unset to run without storage. See
[`BLOB_STORAGE_PROVIDER`](../configuration/mcp-config/env-vars.md#blob_storage_provider) for the
full effect on each tool.

```ts
interface BlobStorageProvider {
  upload(params: {
    key: string;
    data: AsyncIterable<Uint8Array>;
    contentType: string;
    contentLength?: number;
  }): Promise<{ url: string; expiresAt?: string }>;

  getPresignedUploadUrl(params: {
    key: string;
    contentType: string;
    maxBytes?: number;
  }): Promise<{ uploadUrl: string; requiredHeaders: Record<string, string>; expiresAt?: string }>;

  download(params: {
    key: string;
    maxBytes: number;
  }): Promise<{ data: AsyncIterable<Uint8Array>; contentLength?: number } | undefined>;
}
```

All three methods are required. Your provider must follow these rules:

- **Keys.** A key is a relative path with `/` separators. Store it as given, and return the same
  blob for the same key. You may add your own prefix, such as a bucket folder.
- **`upload`.** Read `data` to the end before you resolve. You can read it only once. When
  `contentLength` is set, it is the exact byte count, so a single `PUT` works. When it is missing,
  handle the unknown length yourself, for example with a multipart upload.
- **`upload` result.** The `url` goes to the MCP client as it is. It must work without credentials
  and should expire soon, such as a presigned `GET`. Set `expiresAt` to an ISO 8601 UTC timestamp,
  such as `2026-01-01T00:00:00.000Z`.
- **`getPresignedUploadUrl`.** Return a URL that the client can upload to directly. Put every header
  that the URL's signature covers in `requiredHeaders`, including `Content-Type` set to
  `contentType`. You may enforce `maxBytes` in the signature. A plain presigned `PUT` cannot, and
  that is fine: the server checks the size again when it reads the upload back.
- **`download`.** Return `undefined` only when the key does not exist. Throw if you know the object is
  larger than `maxBytes`. Never truncate. Return the stream without reading it, and set
  `contentLength` when you know it. The server also enforces `maxBytes` as it reads.

This example uses S3. It needs `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. It sets the
bucket in the `bucket` field of `BLOB_STORAGE_PROVIDER_CONFIG`.

```ts title="s3-blob-storage.ts"
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { BlobStorageProvider } from '@tableau/mcp-server/blobStorage/blobStorageProvider';
import { Readable } from 'node:stream';

export default class S3BlobStorage implements BlobStorageProvider {
  private readonly s3 = new S3Client({});
  private readonly bucket: string;

  constructor(config: { module: string; bucket: string }) {
    this.bucket = config.bucket;
  }

  async upload(params: {
    key: string;
    data: AsyncIterable<Uint8Array>;
    contentType: string;
    contentLength?: number;
  }): Promise<{ url: string; expiresAt?: string }> {
    // Only use a single PUT when the length is known. Otherwise use a multipart upload.
    if (params.contentLength === undefined) {
      throw new Error('This example needs contentLength');
    }
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: Readable.from(params.data),
        ContentLength: params.contentLength,
        ContentType: params.contentType,
      }),
    );
    const expiresIn = 3600;
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: params.key }),
      { expiresIn },
    );
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  }

  async getPresignedUploadUrl(params: {
    key: string;
    contentType: string;
    maxBytes?: number;
  }): Promise<{ uploadUrl: string; requiredHeaders: Record<string, string>; expiresAt?: string }> {
    const expiresIn = 900;
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        ContentType: params.contentType,
      }),
      { expiresIn },
    );
    return {
      uploadUrl,
      requiredHeaders: { 'Content-Type': params.contentType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async download(params: {
    key: string;
    maxBytes: number;
  }): Promise<{ data: AsyncIterable<Uint8Array>; contentLength?: number } | undefined> {
    try {
      const { Body, ContentLength } = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: params.key }),
      );
      if (ContentLength !== undefined && ContentLength > params.maxBytes) {
        (Body as Readable).destroy();
        throw new Error(`Object is ${ContentLength} bytes, over the ${params.maxBytes} limit`);
      }
      return { data: Body as Readable, contentLength: ContentLength };
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') return undefined;
      throw error;
    }
  }
}
```

To load it, compile it to JavaScript and set:

```bash
BLOB_STORAGE_PROVIDER=custom
BLOB_STORAGE_PROVIDER_CONFIG='{"module":"./s3-blob-storage.js","bucket":"my-bucket"}'
```

### Upgrading from the S3 variables

`MCP_S3_BUCKET`, `MCP_IMAGE_PREFIX`, `FILE_TTL`, and `AWS_DEFAULT_REGION` no longer work. If the
server starts with any of `MCP_S3_BUCKET`, `MCP_IMAGE_PREFIX`, or `FILE_TTL` set and
`BLOB_STORAGE_PROVIDER` unset, it fails to start. Write a custom provider like the one above, set
`BLOB_STORAGE_PROVIDER=custom`, and remove the old variables. The
[upgrade note](../configuration/mcp-config/env-vars.md#blob_storage_provider) has the details.

## Session store

The embedded OAuth server keeps short-lived state in the session store: pending authorizations,
authorization codes, refresh tokens, and client registrations. It applies only when
[`AUTH`](../configuration/mcp-config/env-vars.md#auth) is `oauth` with the embedded authorization
server on. See [`SESSION_STORE_PROVIDER`](../configuration/mcp-config/oauth.md#session_store_provider).

The default `memory` store lives in one process. Use a custom store to keep state across restarts
and to share it between instances.

```ts
interface SessionStore<V> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
  consume(key: string): Promise<V | undefined>;
  configureNamespace?(namespace: string, options: { ttlMs: number; maxSize?: number }): void;
  init?(): Promise<void>;
  close?(): Promise<void>;
}
```

`get`, `set`, `delete`, and `consume` are required.

- **One shared provider.** The server creates one instance. It prefixes each key with its namespace
  and a colon, such as `<namespace>:<key>`, so the namespaces do not collide.
- **Expiry.** `set` has no TTL argument. The server calls `configureNamespace` with the TTL for each
  namespace. You apply it yourself, for example with a Redis `EX` option. The server may call
  `configureNamespace` more than once with the same values, so make repeat calls safe.
- **`consume`.** It returns the value and removes it in one atomic step, so no two callers get the
  same value. This must be atomic in your backend, for example a Redis Lua script, an ETag
  conditional delete, or a database transaction.
- **`init`.** The server awaits it once at startup. If it rejects, the server does not start. Use it
  to check that the backend is reachable.
- **`close`.** The server awaits it on `SIGTERM` and `SIGINT`.

The next example keeps values in process memory, so it is only a shape to follow. Replace the
`Map` with calls to your shared backend.

```ts title="my-session-store.ts"
import type { SessionStore } from '@tableau/mcp-server/sessionStore/sessionStore';

// Minimal single-process sketch. A real provider calls a shared backend such as Redis.
export default class MySessionStore implements SessionStore<unknown> {
  private readonly values = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly ttls = new Map<string, number>();

  configureNamespace(namespace: string, options: { ttlMs: number }): void {
    this.ttls.set(namespace, options.ttlMs);
  }

  async get(key: string): Promise<unknown> {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: unknown): Promise<void> {
    // Keys arrive as "<namespace>:<key>".
    const ttlMs = this.ttls.get(key.split(':')[0]) ?? 60_000;
    this.values.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async consume(key: string): Promise<unknown> {
    const value = await this.get(key);
    this.values.delete(key);
    return value;
  }
}
```

## Telemetry

The telemetry provider receives metrics from the server. The default does nothing. See
[`TELEMETRY_PROVIDER`](../configuration/mcp-config/env-vars.md#telemetry_provider).

```ts
type TelemetryAttributes = Record<string, string | number | boolean | undefined>;

interface TelemetryProvider {
  initialize(): void;
  recordMetric(name: string, value: number, attributes: TelemetryAttributes): void;
  recordHistogram(name: string, value: number, attributes: TelemetryAttributes): void;
}
```

All three methods are required.

- **`initialize`.** The server calls it once, right after it builds your class. Start your agent or
  exporter here. If it throws, the server falls back to `noop`.
- **`recordMetric`.** Records a counter. For example, a tool call count.
- **`recordHistogram`.** Records one observation, such as a duration in milliseconds.

Remember to run the server with the `-r ./build/telemetry/tracing.js` preload. See
[How custom providers load](#how-custom-providers-load).

```ts title="my-telemetry.ts"
import type {
  TelemetryAttributes,
  TelemetryProvider,
} from '@tableau/mcp-server/telemetry/telemetryProvider';

export default class MyTelemetry implements TelemetryProvider {
  initialize(): void {
    // Start your agent or exporter here.
  }

  recordMetric(name: string, value: number, attributes: TelemetryAttributes): void {
    console.log('metric', name, value, attributes);
  }

  recordHistogram(name: string, value: number, attributes: TelemetryAttributes): void {
    console.log('histogram', name, value, attributes);
  }
}
```

## Feature gates

The feature gate provider answers one question: is this feature on? The default `server` provider
reads `features.json`. A custom provider can look features up in your own service. See
[`FEATURE_GATE_PROVIDER`](../configuration/mcp-config/env-vars.md#feature_gate_provider).

```ts
interface FeatureGateProvider {
  isFeatureEnabled(featureName: string): Promise<boolean>;
}
```

`isFeatureEnabled` is required. It returns a promise, so you can do a real lookup on each call.
Resolve to `false` for any name you do not know.

```ts title="my-feature-gate.ts"
import type { FeatureGateProvider } from '@tableau/mcp-server/features/featureGateProvider';

export default class MyFeatureGate implements FeatureGateProvider {
  private readonly enabled: Set<string>;

  constructor(config: { module: string; enabled?: string[] }) {
    this.enabled = new Set(config.enabled ?? []);
  }

  async isFeatureEnabled(featureName: string): Promise<boolean> {
    return this.enabled.has(featureName);
  }
}
```
