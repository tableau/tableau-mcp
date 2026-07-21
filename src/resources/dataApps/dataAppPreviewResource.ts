/**
 * The `data-app://workspace/{appId}/preview` MCP resource.
 *
 * Exposes a data-app workspace's current entry HTML as a **transport-neutral, read-only source
 * representation** so a client without direct filesystem access can inspect what would be published.
 * It is deliberately *not* a running app and *not* a public HTTP endpoint: the server never hosts the
 * page, makes no promise that any given host executes its JavaScript, and returns only the exact HTML
 * source plus a SHA-256 digest and byte length.
 *
 * Actor scope (the storage trust boundary) is derived **exclusively from server-verified request
 * signals** carried on the MCP `extra` (`authInfo`, `sessionId`) plus the process transport/server
 * config — never from anything the caller supplies. The `{appId}` in the URI is only an opaque
 * handle: a workspace that belongs to a different actor scope, or one that has expired, returns the
 * same not-found signal as one that never existed, so a guessed `appId` cannot leak another scope's
 * source.
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  ReadResourceResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';

import { getConfig } from '../../config.js';
import { getDataAppWorkspaceStore } from '../../dataApps/init.js';
import { isOpaqueId } from '../../dataApps/opaqueId.js';
import type { DataAppWorkspace, WorkspaceScope } from '../../dataApps/types.js';
import { resolveWorkspaceScope } from '../../dataApps/workspaceScope.js';
import { DataAppWorkspaceNotFoundError } from '../../errors/mcpToolError.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import { DATA_APP_ENTRYPOINT, DATA_APP_MANIFEST_PATH } from '../../tools/web/dataApps/templates.js';
import { WebTemplateResourceFactory, WebTemplateResourceRegistration } from '../registry.js';

/** The dynamic URI template clients read to fetch a workspace preview. */
export const DATA_APP_PREVIEW_URI_TEMPLATE = 'data-app://workspace/{appId}/preview';

/** Namespaced key for the preview's source metadata on the returned resource content. */
export const PREVIEW_META_KEY = 'tableau/dataAppPreview';

/** Build the canonical preview URI for a workspace. Shared with `scaffold-data-app` to avoid drift. */
export function buildDataAppPreviewUri(appId: string): string {
  return `data-app://workspace/${appId}/preview`;
}

const description = [
  'A transport-neutral, read-only snapshot of a data-app workspace entry HTML, addressed by an',
  'opaque appId. Returns the exact HTML source together with a SHA-256 digest and byte length.',
  'This is a portable *source* representation, not a running application and not a server-hosted',
  'page: whether a client renders it as a native artifact, shows it through an MCP-compatible HTML',
  'surface, or merely offers it as an open/download preview is host-dependent, and JavaScript',
  'execution is not guaranteed on any particular host. The workspace is resolved strictly within',
  "the caller's server-verified actor scope; an appId from another scope, or an expired workspace,",
  'returns a not-found error.',
].join(' ');

/**
 * Resolve the workspace scope for a resource read from server-verified request signals only.
 *
 * This mirrors the tool-side `resolveScopeFromExtra`: `resolveWorkspaceScope` remains the single
 * source of truth for the scoping policy, and this only extracts its inputs from the MCP `extra`
 * (authenticated Tableau identity / MCP session) and the process config. It never reads a
 * caller-supplied scope value.
 */
function resolveScopeFromResourceExtra(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
): ReturnType<typeof resolveWorkspaceScope> {
  const config = getConfig();
  const authInfo = getTableauAuthInfo(extra.authInfo);
  return resolveWorkspaceScope({
    transport: config.transport,
    server: authInfo?.server || config.server,
    siteId: authInfo?.siteId,
    userId: authInfo?.userId,
    sessionId: extra.sessionId,
  });
}

function readAppIdVariable(value: string | string[] | undefined): string {
  const appId = Array.isArray(value) ? value[0] : value;
  return (appId ?? '').trim();
}

/**
 * Pick the entry file to preview: the manifest's declared entrypoint when it is present and refers to
 * a real workspace file, otherwise the default `index.html`. A missing/corrupt manifest never fails
 * the read; it falls back to the default. If the resolved entry file does not exist, the subsequent
 * `readFile` throws a clean not-found error.
 */
async function resolveEntrypoint(
  scope: WorkspaceScope,
  appId: string,
  workspace: DataAppWorkspace,
): Promise<string> {
  const hasManifest = workspace.files.some((file) => file.path === DATA_APP_MANIFEST_PATH);
  if (hasManifest) {
    try {
      const manifestBytes = await getDataAppWorkspaceStore().readFile(
        scope,
        appId,
        DATA_APP_MANIFEST_PATH,
      );
      const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8')) as {
        entrypoint?: unknown;
      };
      const entrypoint = manifest.entrypoint;
      if (
        typeof entrypoint === 'string' &&
        entrypoint.toLowerCase().endsWith('.html') &&
        workspace.files.some((file) => file.path === entrypoint)
      ) {
        return entrypoint;
      }
    } catch {
      // Fall through to the default entrypoint on any manifest read/parse issue.
    }
  }
  return DATA_APP_ENTRYPOINT;
}

export const getDataAppPreviewResource: WebTemplateResourceFactory =
  (): WebTemplateResourceRegistration => ({
    name: 'data-app-preview',
    template: new ResourceTemplate(DATA_APP_PREVIEW_URI_TEMPLATE, { list: undefined }),
    title: 'Data App Preview',
    description,
    mimeType: 'text/html',
    read: async (uri, variables, extra): Promise<ReadResourceResult> => {
      const scope = resolveScopeFromResourceExtra(extra);
      if (scope.isErr()) {
        // No safe multi-user isolation is possible for this request; fail cleanly.
        throw scope.error;
      }

      const appId = readAppIdVariable(variables.appId);
      if (!isOpaqueId(appId)) {
        // Keep malformed, wrong-scope, expired, and unknown handles indistinguishable at the public
        // resource boundary. In particular, do not leak the store's stricter path-validation error.
        throw new DataAppWorkspaceNotFoundError();
      }
      const store = getDataAppWorkspaceStore();

      // Throws DataAppWorkspaceNotFoundError for wrong-scope / expired / never-existed alike.
      const workspace = await store.get(scope.value, appId);
      const entrypoint = await resolveEntrypoint(scope.value, appId, workspace);
      const bytes = await store.readFile(scope.value, appId, entrypoint);

      const text = Buffer.from(bytes).toString('utf8');
      const digest = createHash('sha256').update(bytes).digest('hex');

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/html',
            text,
            _meta: {
              [PREVIEW_META_KEY]: {
                appId,
                entrypoint,
                digest,
                digestAlgorithm: 'sha256',
                byteLength: bytes.byteLength,
                // Explicitly transport-neutral: this is source, not a promise of execution.
                rendering: 'host-dependent',
                executesJavaScript: false,
              },
            },
          },
        ],
      };
    },
  });
