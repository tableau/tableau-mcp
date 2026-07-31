import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { PublishWorkbookError } from '../../../errors/mcpToolError.js';
import { AUDIT_LOGGER, log } from '../../../logging/logger.js';
import { PublishedWorkbook } from '../../../sdks/tableau/methods/publishingMethods.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { isAxiosError } from '../../../utils/axios.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { constructViewWebUrl } from '../utils/viewUrlUtils.js';

// The single-request publish endpoint accepts files up to 64 MB. Larger files require the File
// Upload session flow, which is not implemented yet — we fail fast with a clear message instead of
// letting the server reject a multi-megabyte multipart body. Used by create-and-publish-workbook,
// which checks the in-memory buffer size: the SDK sets maxBodyLength/maxContentLength to Infinity,
// so this is the only backstop. (Generic by design — the stashed publish-workbook tool applies the
// same guard to an on-disk file size.)
export const MAX_SINGLE_REQUEST_BYTES = 64 * 1024 * 1024;

// The resolved publish target. `id` is always known; `name` is known on the default-project path
// (the resolver queried for it) but absent when the caller passed an explicit projectId — in that
// case we recover the name from the publish response instead. See toPublishResult.
export type ResolvedProject = { id: string; name?: string };

type PublishResultBase = {
  id: string;
  name: string;
  // The canonical clickable URL — bind links (prose or a UI card's href) to this. Prefers a direct
  // link to the workbook's first materialized view (its opening sheet); falls back to the workbook's
  // Views tab (webpageUrl + `/views`) when the publish response carried no usable view contentUrl.
  // Omitted (never fabricated) when neither is available. See toPublishResult. The raw server value
  // stays on `webpageUrl`.
  url?: string;
  contentUrl?: string;
  webpageUrl?: string;
};

export type PublishResult =
  | (PublishResultBase & {
      location: 'project';
      projectId: string;
      projectName?: string;
    })
  | (PublishResultBase & {
      location: 'personalSpace';
      personalSpaceLuid: string;
    });

export type PublishTarget =
  | { location: 'project'; id: string; name?: string }
  | { location: 'personalSpace'; luid: string };

// Returns the precondition error to surface, or null when the size is acceptable. Callers turn a
// non-null result into a returned Err (never a throw) so it renders as a clean tool error.
export function checkUnder64Mb(sizeBytes: number): PublishWorkbookError | null {
  if (sizeBytes > MAX_SINGLE_REQUEST_BYTES) {
    return new PublishWorkbookError(
      `File is ${Math.round(sizeBytes / (1024 * 1024))} MB, which exceeds the 64 MB single-request ` +
        'publish limit. Chunked upload is not yet supported.',
    );
  }
  return null;
}

// Resolve the project to publish into: the caller's projectId, or the site's default project when
// none is given. Personal-space publish bypasses this resolver entirely.
export async function resolveTargetProject(
  restApi: RestApi,
  projectId: string | undefined,
): Promise<Result<ResolvedProject, PublishWorkbookError>> {
  if (projectId) {
    // Caller gave an explicit LUID; we don't have its display name here (and won't spend an extra
    // query for it). The publish response carries project.name, so toPublishResult recovers it.
    return new Ok({ id: projectId });
  }

  const { projects } = await restApi.projectsMethods.queryProjects({
    siteId: restApi.siteId,
    filter: 'name:eq:Default',
  });
  const defaultProject = projects.find((p) => p.topLevelProject) ?? projects[0];
  if (!defaultProject) {
    return new PublishWorkbookError(
      'Could not find the site default project to publish into. ' +
        'Pass an explicit projectId instead.',
    ).toErr();
  }
  return new Ok({ id: defaultProject.id, name: defaultProject.name });
}

// The stable identity of the principal attempting a publish, captured for the audit trail. Derived
// only from server-verified request signals (`extra`), never from a caller-supplied argument, and
// never a raw PAT/token.
export type PublishActor = {
  username?: string;
  userLuid?: string;
  siteLuid: string;
  siteName: string;
};

export function buildPublishActor(extra: TableauWebRequestHandlerExtra): PublishActor {
  return {
    username: extra.tableauAuthInfo?.username,
    userLuid: extra.getUserLuid(),
    siteLuid: extra.getSiteLuid(),
    siteName: extra.getSiteName(),
  };
}

// A single authoritative publish-audit record. Every field is safe to persist: it records WHO
// published WHICH validated package WHERE and with WHAT terminal outcome. It deliberately carries no
// source contents, static query rows, tokens, or file bytes — only opaque handles (validationId /
// appId), the content digest, and the caller-supplied publish-target arguments (bound per call so a
// reused receipt's audit trail distinguishes each attempt).
const publishAuditRecordSchema = z.object({
  schemaVersion: z.literal(1),
  timestamp: z.string(),
  tool: z.string(),
  actor: z.object({
    username: z.string().optional(),
    userLuid: z.string().optional(),
    siteLuid: z.string(),
    siteName: z.string(),
  }),
  appId: z.string(),
  validationId: z.string(),
  digest: z.string(),
  workbookName: z.string().optional(),
  // Destination: 'project' pairs with projectId, 'personalSpace' with personalSpaceLuid.
  targetType: z.enum(['project', 'personalSpace']),
  projectId: z.string().optional(),
  personalSpaceLuid: z.string().optional(),
  showTabs: z.boolean(),
  overwrite: z.boolean(),
  outcome: z.enum(['published', 'failed']),
  // Fixed, bounded classifications only. Raw exception messages can contain credentials, request
  // bodies, or source data and must never enter the durable audit trail.
  failureCode: z
    .enum([
      'rest-api-setup-failed',
      'target-project-query-failed',
      'target-project-not-found',
      'personal-space-query-failed',
      'personal-space-not-available',
      'publish-workbook-failed',
    ])
    .optional(),
});

export type PublishAuditRecord = z.infer<typeof publishAuditRecordSchema>;

/**
 * Validates and emits a single publish-audit record to the durable log sink on the dedicated `audit`
 * logger (which bypasses the LOG_LEVEL severity filter, so an operator cannot suppress it). Parsing
 * through the schema guarantees the record only ever carries the safe, whitelisted fields — never
 * bytes, tokens, or source content. Audit is best-effort and MUST NOT affect tool behavior: malformed
 * audit data or a failing log sink is contained here so it cannot mask the original REST result.
 */
export function emitPublishAudit(
  record: Omit<PublishAuditRecord, 'schemaVersion' | 'timestamp'>,
): void {
  const parsed = publishAuditRecordSchema.safeParse({
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    ...record,
  });
  if (!parsed.success) {
    return;
  }
  try {
    log({ message: 'publish-audit', level: 'notice', logger: AUDIT_LOGGER, data: parsed.data });
  } catch {
    // Deliberately swallow audit-sink failures. The caller's original publish outcome is
    // authoritative and must never be replaced by a logging exception.
  }
}

// The server's workbook webpageUrl (e.g. .../#/workbooks/19) points at the workbook page; the bare
// route is not a reliable landing target, so we append the `/views` segment to open the workbook's
// Views tab instead. This is a deterministic, site-path-agnostic transform — we only append a fixed
// segment, never fabricate an id. Used as the FALLBACK in toPublishResult when the publish response
// carried no usable view contentUrl to build a direct per-view URL from. Idempotent and tolerant of
// a trailing slash.
export function toWorkbookViewsUrl(webpageUrl: string): string {
  const trimmed = webpageUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/views') ? trimmed : `${trimmed}/views`;
}

// Rebase a server-advertised URL onto the origin the client is actually configured to reach. The
// publish response's webpageUrl carries the server's own gateway host, which on some deployments
// (e.g. on-prem / test servers) is an internal IP that differs from the configured SERVER origin the
// user connects through — returning that host yields a link the caller may not be able to open. We
// keep the server's path/hash (they hold the real repository id and SPA route) and swap only
// scheme+host+port for the configured origin. Returns the input unchanged if either value is missing
// or unparseable — never fabricates.
export function rebaseUrlOrigin(rawUrl: string, serverOrigin: string | undefined): string {
  if (!serverOrigin) {
    return rawUrl;
  }
  try {
    const parsed = new URL(rawUrl);
    const origin = new URL(serverOrigin).origin;
    return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return rawUrl;
  }
}

// Map the SDK's PublishedWorkbook onto the tool result for the resolved `target`. `url` is the
// canonical clickable link: we prefer a direct link to the workbook's first materialized view (its
// opening sheet), built from that view's contentUrl against the configured SERVER origin + site —
// this lands the user on rendered content instead of the workbook's Views-tab index. When the
// publish response carries no usable view contentUrl (or we have no origin to build against) we fall
// back to the workbook Views tab (webpageUrl rebased onto the SERVER origin). `webpageUrl` always
// keeps the raw server value. `url` is omitted (never fabricated) when neither source is available.
// A view URL needs a concrete origin, so `serverOrigin` gates it; `siteName` selects the site path
// ('' / 'Default' → the default-site route).
export function toPublishResult(
  published: PublishedWorkbook,
  target: PublishTarget,
  serverOrigin?: string,
  siteName?: string,
): PublishResult {
  const firstView = published.views?.view?.find((view) => view.contentUrl);
  const viewUrl =
    serverOrigin && firstView?.contentUrl
      ? constructViewWebUrl(serverOrigin, siteName ?? '', firstView.contentUrl)
      : undefined;
  const workbookUrl =
    published.webpageUrl !== undefined
      ? toWorkbookViewsUrl(rebaseUrlOrigin(published.webpageUrl, serverOrigin))
      : undefined;
  const url = viewUrl ?? workbookUrl;
  const base: PublishResultBase = {
    id: published.id,
    name: published.name,
    url,
    contentUrl: published.contentUrl,
    webpageUrl: published.webpageUrl,
  };
  if (target.location === 'personalSpace') {
    return { ...base, location: 'personalSpace', personalSpaceLuid: target.luid };
  }
  return {
    ...base,
    location: 'project',
    projectId: target.id,
    // Prefer the name the resolver knew (default-project path); otherwise recover it from the
    // publish response (explicit-projectId path). Undefined only if neither supplied one.
    projectName: target.name ?? published.project?.name,
  };
}

// Map the server's "personal-space publish is disabled for this site" gate to a clean tool error, or
// null for anything else so the caller rethrows to the generic handler.
export function mapPersonalSpacePublishError(error: unknown): PublishWorkbookError | null {
  if (!isAxiosError(error) || error.response?.status !== 400) {
    return null;
  }
  const body = error.response.data as { error?: { code?: string; detail?: string } } | undefined;
  const detail = (body?.error?.detail ?? '').toLowerCase();
  if (body?.error?.code === '400000' && detail.includes('personal space')) {
    return new PublishWorkbookError(
      'Publishing directly to a personal space is not enabled for this Tableau site. Publish to a ' +
        'project instead, or ask a site administrator to enable personal-space publishing.',
    );
  }
  return null;
}
