import { Ok, Result } from 'ts-results-es';

import { PublishWorkbookError } from '../../../errors/mcpToolError.js';
import { PublishedWorkbook } from '../../../sdks/tableau/methods/publishingMethods.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';

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

export type PublishResult = {
  id: string;
  name: string;
  location: 'project';
  projectId: string;
  // Human-readable name of the project we published into (e.g. "Default"), for display. Prefer this
  // over projectId for any user-facing label. Omitted only when neither the resolver nor the publish
  // response supplied a name.
  projectName?: string;
  // The canonical clickable workbook URL — bind links (prose or a UI card's href) to this. It is
  // the server's webpageUrl passed through verbatim; omitted when the server returned none. See
  // toPublishResult for why we surface rather than construct it.
  url?: string;
  contentUrl?: string;
  webpageUrl?: string;
};

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
// none is given. (Personal-space publish is not yet supported by the REST API in a single call, so
// an omitted projectId lands in the default project for now.)
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

// Map the SDK's PublishedWorkbook onto the tool result. projectId is the *resolved* target we
// published into (not published.project?.id). `url` is the canonical clickable workbook URL,
// surfaced verbatim from the server's webpageUrl — the only correct URL in hand. We can't build one
// ourselves post-publish: the publish response carries no views (so no /views/{sheet} URL) and the
// numeric repository id lives only inside webpageUrl (the GUID `id` isn't URL-routable). Omitted
// when the server returned no webpageUrl — better an absent link than a fabricated one.
export function toPublishResult(
  published: PublishedWorkbook,
  target: ResolvedProject,
): PublishResult {
  return {
    id: published.id,
    name: published.name,
    location: 'project',
    projectId: target.id,
    // Prefer the name the resolver knew (default-project path); otherwise recover it from the
    // publish response (explicit-projectId path). Undefined only if neither supplied one.
    projectName: target.name ?? published.project?.name,
    url: published.webpageUrl,
    contentUrl: published.contentUrl,
    webpageUrl: published.webpageUrl,
  };
}
