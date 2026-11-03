# PROTOTYPE: file-upload picker MCP App

Throwaway spike, not for merge. It tests whether an MCP App iframe can let a user pick a local
file and PUT it straight to a presigned upload URL, so the file and the URL never pass through the
model.

## What it adds

| Piece | Where |
| --- | --- |
| `pick-upload-file`: model-visible app tool. Renders the picker and returns `uploadId` (no URL). Hidden when the client can't render MCP Apps (`hideWhenUnsupported`) and gated on `mcp-apps`. | `src/tools/web/uploadPicker/pickUploadFile.ts` |
| `get-upload-url`: app-only tool (`visibility: ['app']`). The iframe calls it after the pick with `{uploadId, fileName, fileSize}` and gets back `{uploadUrl, requiredHeaders}`. | `src/tools/web/uploadPicker/getUploadUrl.ts` |
| Picker UI: file input + drag-drop, XHR PUT with progress, then `ui/message` (falls back to `ui/update-model-context`) | `src/web/apps/src/upload/` |
| CSP: the upload origin goes into the app's `connectDomains`, taken from the provider's optional `getUploadOrigins()` or, if that's missing, from the origin of a probe presigned URL | `src/blobStorage/init.ts` (`getBlobUploadOrigins`), `AppDetails.extraConnectDomains` |
| DEV-ONLY fake blob provider: its own HTTP server on another port, signed PUT URLs, S3-like CORS | `scripts/dev/fakePresignedUploadProvider.cjs` |

`request-upload` is unchanged. The model still uses it for the curl path, which non-Apps clients
depend on.

## Run locally (fake upload origin, real or stubbed Tableau)

```bash
npm run build
# Turn the flag on in the built copy only (the source features.json stays untouched):
node -e "const f='build/features.json',d=require('./'+f);d['mcp-apps']=true;require('fs').writeFileSync(f,JSON.stringify(d,null,2))"

TRANSPORT=http DANGEROUSLY_DISABLE_OAUTH=true PORT=3937 \
AUTH=pat SERVER=https://<your-pod>.online.tableau.com SITE_NAME=<site> PAT_NAME=<name> PAT_VALUE=<value> \
BLOB_STORAGE_PROVIDER=custom \
BLOB_STORAGE_PROVIDER_CONFIG='{"module":"./scripts/dev/fakePresignedUploadProvider.cjs","port":3929,"dir":"/tmp/fake-blobs"}' \
node build/index.js
```

- The MCP endpoint is `http://localhost:3937/tableau-mcp`. Uploads go to `http://127.0.0.1:3929`,
  which is a different origin, so the cross-origin path really runs. Bytes land under `dir`.
- Fake provider config keys: `port`, `host` (default `127.0.0.1`), `dir`, and `publicOrigin` (for
  tunnels, see below). Its log lines start with `[fake-upload]` and show each OPTIONS/PUT with its
  `Origin` header.
- `publish-workbook` with the `uploadId` reads the bytes back through the fake provider's
  `download()`. That needs a real Tableau site.
- If you have no Tableau site, a stub that answers `GET /api/*/serverinfo` and
  `POST /api/*/auth/signin` is enough to boot the server and run pick → get-upload-url → PUT.

## Try it in a real MCP Apps host

1. **ext-apps basic host (not tried).** No example host ships in `node_modules`, only the
   `AppBridge` library (`@modelcontextprotocol/ext-apps/app-bridge`). Clone the ext-apps repo and
   point its `examples/basic-host` at `http://localhost:3937/tableau-mcp`.
2. **Claude Desktop / claude.ai custom connector.** The server force-excludes claude.ai OAuth
   clients from MCP Apps (`isKnownIncompatibleClient` in `src/server.web.ts`, PR #861), so
   `pick-upload-file` is **hidden** there. To try it, you would have to remove that exclusion
   locally, which this spike does not do. Connections without a `clientId` (DANGEROUSLY_DISABLE_OAUTH,
   stdio) are not excluded.
3. **ChatGPT developer mode.** ChatGPT needs a public HTTPS MCP URL, and its iframe cannot reach
   `127.0.0.1` (Chrome Private Network Access). Tunnel both ports and tell the fake provider its
   public origin:
   ```bash
   ngrok http 3937   # -> https://mcp-xyz.ngrok.app  (connector URL: <that>/tableau-mcp)
   ngrok http 3929   # -> https://up-xyz.ngrok.app
   BLOB_STORAGE_PROVIDER_CONFIG='{"module":"./scripts/dev/fakePresignedUploadProvider.cjs","port":3929,"publicOrigin":"https://up-xyz.ngrok.app"}'
   ```
   Then in ChatGPT: Settings → Apps & Connectors → Advanced → Developer mode → add the connector.
   Ask it to "let me upload a workbook from my computer". Open the iframe's devtools console and
   look for `[upload-picker] ... host-approved connectDomains`. It shows whether the host kept the
   upload origin in its CSP.

## Verified locally (Chromium via Playwright, scratch scripts not committed)

- The MCP flow works: `pick-upload-file` returns `uploadId` and no URL. The resource `_meta.ui.csp.connectDomains`
  includes the fake upload origin, derived through `getUploadOrigins()`. `get-upload-url` signs a
  URL under the same `uploadId` and tenant key.
- The real built `upload-picker.html` ran in a `sandbox="allow-scripts"` iframe (origin `null`)
  behind a minimal AppBridge host. It picked a 3 MB file, called `get-upload-url` through the host,
  sent the PUT with progress, stored the bytes at the right key, and sent a `ui/message` with the `uploadId`.
- With the upload origin removed from CSP, the PUT is blocked (`connect-src` violation, XHR status 0)
  and the UI shows an error.
- Preflight from `Origin: null` and from `Origin: https://<host>` both pass with
  `Access-Control-Allow-Origin: *`.

## Not verified

- Real hosts' sandbox and CSP handling (ChatGPT, claude.ai, VS Code), and whether they keep a
  non-Tableau `connectDomains` entry.
- Real S3 CORS. In particular, whether S3 `AllowedOrigins: ["*"]` matches `Origin: null`. Everything
  here was tested against the fake provider.
- Whether hosts support `ui/message` or `ui/update-model-context`, and how they behave when they do.
