/**
 * Shared plumbing for declaring a data app's runtime fetch/connect origins.
 *
 * A published data app runs under a strict Content-Security-Policy; the served content can only
 * fetch/XHR to origins the package manifest declares. The declaration lives in the tool-managed
 * `dataapp.json` (`allowedOrigins`), which is protected from ordinary upserts. The data-app write
 * tools (`upsert-data-app-files`, `patch-data-app-file`) accept an optional `allowedOrigins` param
 * so an author declares an origin in the SAME call that writes the code that fetches it — rather
 * than editing a manifest they never see. This module owns the param schema and the narrow
 * read-modify-write that changes only that one key.
 */

import { z } from 'zod';

import type { DataAppUpsertResult, WorkspaceScope } from '../../../dataApps/types.js';
import type { DataAppWorkspaceStore } from '../../../dataApps/workspaceStore.js';
import { buildDataAppManifest, DATA_APP_MANIFEST_PATH, DataAppManifest } from './templates.js';

/**
 * Optional param, shared by the data-app write tools, declaring the external origins the published
 * app is allowed to fetch/connect to at runtime. Omitted ⇒ leave the current setting unchanged; an
 * empty/whitespace string ⇒ clear it; a non-empty string ⇒ set it (trimmed).
 */
export const allowedOriginsParam = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .describe(
    'Optional. Space-separated external origins (scheme + host, optional port — e.g. ' +
      '"https://api.example.com https://cdn.example.com") the published app may fetch/XHR at ' +
      'runtime. A published data app runs under a strict Content-Security-Policy, so any request to ' +
      'an origin NOT declared here is blocked — and, because there is no console in the sandbox, the ' +
      'failure surfaces only as an on-screen error after publish. Declare an origin here in the same ' +
      'call that writes the code that fetches it. Same-origin requests need no declaration. This ' +
      'value REPLACES the whole allow-list (it does not append), so always pass the COMPLETE set of ' +
      'origins the app needs — including any declared earlier. Omit this param to leave the current ' +
      'setting unchanged; pass an empty string to clear it.',
  );

/**
 * Update ONLY the `allowedOrigins` key of the tool-managed `dataapp.json`, preserving every other
 * manifest field, and return the post-write workspace digest.
 *
 * The manifest is re-serialized through {@link buildDataAppManifest} so its bytes stay identical to
 * a scaffold's (the key is emitted last, and only when non-empty). `allowedOrigins` is the caller's
 * raw string: a non-empty value sets it (trimmed); a blank value clears it. Callers pass this only
 * when they intend to change the setting — an omitted param must be handled by the caller (skip the
 * call), never routed here.
 */
export async function updateManifestAllowedOrigins(
  store: DataAppWorkspaceStore,
  scope: WorkspaceScope,
  appId: string,
  allowedOrigins: string,
): Promise<DataAppUpsertResult> {
  const raw = await store.readFile(scope, appId, DATA_APP_MANIFEST_PATH);
  const existing = JSON.parse(Buffer.from(raw).toString('utf8')) as DataAppManifest;
  const manifest = buildDataAppManifest({
    appName: existing.appName,
    packageId: existing.packageId,
    template: existing.template,
    datasources: existing.datasources,
    allowedOrigins,
  });
  return store.writeManifest(scope, appId, `${JSON.stringify(manifest, null, 2)}\n`);
}
