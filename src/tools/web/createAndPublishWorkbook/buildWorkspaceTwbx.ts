// Pure adapter from an immutable data-app workspace snapshot to the deterministic TWBX builder.
//
// The source of truth is a `DataAppSnapshot` captured by the scoped workspace store: the entrypoint
// is always the workspace's `index.html`, every other publishable file is mapped to content-relative
// bytes verbatim, and NOTHING is split or rewritten on the way in — scaffolded JS/CSS are already
// explicit sibling files, so there is no split-on-publish step. The adapter stays pure: identical
// snapshot in → byte-identical package out (buildTwbx itself is deterministic). It is the single
// feeder into buildTwbx now that validate-workbook-package produces the receipt this build backs.

import type { DataAppSnapshot } from '../../../dataApps/types.js';
import { BuildTwbxError } from '../../../errors/mcpToolError.js';
import type { DataAppManifest } from '../dataApps/templates.js';
import { buildTwbx, BuildTwbxResult, DataAppDatasource } from './buildTwbx.js';

/** The single extension entrypoint every workspace package is built around (buildTwbx's .trex
 *  hard-codes `<source-location>index.html</source-location>`, so the packaged entry MUST be this). */
export const WORKSPACE_ENTRYPOINT = 'index.html';

/** The tool-managed manifest. It is workspace metadata, not part of the rendered app, so it is never
 *  shipped as executable package content. */
export const WORKSPACE_MANIFEST = 'dataapp.json';

export interface BuildWorkspaceTwbxOptions {
  /** Display name for the workbook and the base name of the `.twb` inside the package. */
  workbookName: string;
  /** The extension id (also the `Packages/<id>/` folder name). Validated by buildTwbx. */
  packageId: string;
}

/**
 * Read the datasource bindings the builder needs from the workspace's `dataapp.json` manifest. The
 * manifest is a workspace file (not shipped as package content); it records the published-datasource
 * identity + the zombie-sheet field resolved at scaffold time. A missing/malformed manifest, or one
 * with no datasources, yields an empty list — the builder then produces an extension-only workbook.
 */
export function readDatasourceBindings(snapshot: DataAppSnapshot): DataAppDatasource[] {
  const manifestFile = snapshot.files.find(
    (file) => normalizePath(file.path) === WORKSPACE_MANIFEST,
  );
  if (!manifestFile) {
    return [];
  }
  let manifest: DataAppManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestFile.content)) as DataAppManifest;
  } catch {
    return [];
  }
  if (!Array.isArray(manifest.datasources)) {
    return [];
  }
  return manifest.datasources.map((ds) => ({
    sqlproxyName: ds.sqlproxyName,
    contentUrl: ds.contentUrl,
    caption: ds.name,
    host: ds.host,
    port: ds.port,
    field: ds.field,
  }));
}

// A single decoded content-relative file (path already normalized) that will be packaged.
type PackagedFile = { path: string; content: Uint8Array };

// Normalize a stored workspace path to the same content-relative form buildTwbx expects: drop a
// leading `./` and collapse duplicate slashes. Traversal/absolute/backslash paths are already
// rejected by the store on write, and buildTwbx re-checks content-path safety, so this only
// canonicalizes an already-safe path.
function normalizePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/\/+/g, '/');
}

/**
 * The exact set of files that will be written into the package's `content/` directory: the
 * entrypoint plus every other workspace file EXCEPT the tool-managed `dataapp.json` manifest.
 *
 * This is the single source of truth for "what actually gets packaged" — both the builder and the
 * asset-reference check consume it, so reference validation is guaranteed to run against the same
 * bytes that ship.
 */
export function listPackagedWorkspaceFiles(snapshot: DataAppSnapshot): PackagedFile[] {
  return snapshot.files
    .map((file) => ({ path: normalizePath(file.path), content: file.content }))
    .filter((file) => file.path !== WORKSPACE_MANIFEST);
}

/**
 * Build a deterministic TWBX from an immutable workspace snapshot.
 *
 * Throws {@link BuildTwbxError} when the snapshot has no `index.html` entrypoint (a hard structural
 * failure) — as well as for any packaging error buildTwbx itself raises (illegal packageId, unsafe
 * content path). Callers translate these into an `ok:false` validation report rather than crashing.
 */
export function buildWorkspaceTwbx(
  snapshot: DataAppSnapshot,
  options: BuildWorkspaceTwbxOptions,
): BuildTwbxResult {
  const packaged = listPackagedWorkspaceFiles(snapshot);

  const entry = packaged.find((file) => file.path === WORKSPACE_ENTRYPOINT);
  if (!entry) {
    throw new BuildTwbxError(
      `workspace has no ${WORKSPACE_ENTRYPOINT} entrypoint to package as the extension index`,
    );
  }

  const assets = packaged
    .filter((file) => file.path !== WORKSPACE_ENTRYPOINT)
    .map((file) => ({ path: file.path, bytes: file.content }));

  const datasources = readDatasourceBindings(snapshot);

  return buildTwbx({
    packageId: options.packageId,
    workbookName: options.workbookName,
    html: entry.content,
    assets: assets.length > 0 ? assets : undefined,
    datasources: datasources.length > 0 ? datasources : undefined,
  });
}
