// The pure, deterministic INVERSE of `buildWorkspaceTwbx` (+ `buildTwbx`): given the packaged bytes
// of a published data-app workbook (`.twbx`), recover the editable workspace inputs so the workbook
// can be reopened, iterated on with the existing data-app authoring tools, and republished.
//
// A data-app `.twbx` is a zip laid out as:
//   <name>.twb                              -- workbook XML at the archive ROOT
//   Packages/<id>/manifest.json             -- package manifest ("id" == the <id> folder)
//   Packages/<id>/extensions/toolbar.trex   -- the viz-extension manifest (regenerated on rebuild)
//   Packages/<id>/content/index.html        -- the extension entrypoint
//   Packages/<id>/content/**                -- app source (js/css/assets) + the injected Extensions lib
//
// The recovered workspace is what the scaffold flow would have stored: the `content/` files plus a
// rebuilt `dataapp.json` manifest. Two things are re-derived, not copied out:
//   - the Extensions API lib — buildTwbx re-injects it, so we drop it here.
//   - dataapp.json — rebuilt from the `.twb`'s `<datasources>`: contentUrl, sqlproxy name, host,
//     port, and the one host-sheet field. The datasource LUID isn't stored in the workbook, so we
//     leave it "" — safe: the builder ignores `luid` and the live app resolves sources at runtime
//     via `getAllDataSourcesAsync()`.
//
// Pure (bytes in -> bytes out; no clock/config/I/O). Only structural failures throw
// {@link WorkbookDataAppNotFoundError}, which the tool wrapper surfaces as a clean 422.

import { DOMParser } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import * as xpath from 'xpath';

import type { DataAppFileInput } from '../../../dataApps/types.js';
import { WorkbookDataAppNotFoundError } from '../../../errors/mcpToolError.js';
import {
  buildDataAppManifest,
  DATA_APP_MANIFEST_PATH,
  DataAppDatasourceBinding,
  LIVE_EXTENSION_TEMPLATE,
} from '../dataApps/templates.js';
import { DataAppFieldDataType, EXTENSIONS_LIB_PATH } from './buildTwbx.js';

/** Everything the workspace store needs to recreate an editable workspace from a published .twbx. */
export interface ReconstructedWorkspace {
  /** Display name for the workbook (from the manifest `name`, falling back to the .twb base name). */
  appName: string;
  /** The extension id / `Packages/<id>/` folder name (from the manifest `id`). */
  packageId: string;
  /** The published-datasource bindings recovered from the .twb (empty if the app wired none). */
  datasources: DataAppDatasourceBinding[];
  /** The workspace source files: `content/**` (minus the injected lib) + the rebuilt `dataapp.json`. */
  files: DataAppFileInput[];
}

// Matches `Packages/<id>/manifest.json` and captures <id>. <id> is a single path segment (the reader
// 404s if the folder name and the manifest "id" disagree), so it must not itself contain a slash.
const MANIFEST_PATH_RE = /^Packages\/([^/]+)\/manifest\.json$/;

/**
 * Recover the editable workspace inputs from a published data-app workbook's packaged bytes.
 *
 * @throws {WorkbookDataAppNotFoundError} when the bytes are not a valid archive, carry no
 *   `Packages/<id>/manifest.json`, have no `content/index.html` entrypoint, or contain no root `.twb`.
 */
export function reconstructWorkspaceFromTwbx(bytes: Uint8Array): ReconstructedWorkspace {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes);
  } catch {
    throw new WorkbookDataAppNotFoundError(
      'The workbook is not a data-app package: its bytes are not a valid .twbx archive. Only ' +
        'workbooks created and published through the data-app flow can be edited with this tool.',
    );
  }

  // Locate the single package manifest and derive the package id from its folder segment.
  const manifestPath = Object.keys(archive).find((p) => MANIFEST_PATH_RE.test(p));
  if (!manifestPath) {
    throw new WorkbookDataAppNotFoundError(
      'The workbook is not a data-app package (no Packages/<id>/manifest.json). Only workbooks ' +
        'created and published through the data-app flow can be edited with this tool.',
    );
  }
  const folderId = MANIFEST_PATH_RE.exec(manifestPath)![1];

  // The manifest carries the canonical package id and the display name (renderManifest emits
  // { id, version, name, author }). Prefer them; fall back to the folder id / .twb base name so a
  // hand-authored or older package that omits a field still reopens.
  let packageId = folderId;
  let manifestName: string | undefined;
  try {
    const manifest = JSON.parse(strFromU8(archive[manifestPath])) as {
      id?: unknown;
      name?: unknown;
    };
    if (typeof manifest.id === 'string' && manifest.id.length > 0) {
      packageId = manifest.id;
    }
    if (typeof manifest.name === 'string' && manifest.name.length > 0) {
      manifestName = manifest.name;
    }
  } catch {
    // A malformed manifest.json is non-fatal for recovery: fall back to the folder id and .twb name.
  }

  // The entrypoint MUST exist — buildTwbx's .trex hard-codes content/index.html as the source URL.
  const contentPrefix = `Packages/${folderId}/content/`;
  if (!archive[`${contentPrefix}index.html`]) {
    throw new WorkbookDataAppNotFoundError(
      `The data-app package '${folderId}' has no content/index.html entrypoint, so there is no ` +
        'app source to reopen. The workbook may be corrupt or not a data app.',
    );
  }

  // The root workbook XML: a top-level `.twb` (no path separator).
  const twbPath = Object.keys(archive).find(
    (p) => !p.includes('/') && p.toLowerCase().endsWith('.twb'),
  );
  if (!twbPath) {
    throw new WorkbookDataAppNotFoundError(
      'The package has no workbook (.twb) at its root, so it cannot be reopened as a data app.',
    );
  }
  const twbXml = strFromU8(archive[twbPath]);

  const appName = manifestName ?? twbPath.slice(0, -'.twb'.length);

  // Collect the app source under content/, mapped back to workspace-relative paths. Two files are
  // NOT stored in the workspace (they are re-derived on the way back out): the Extensions API library
  // (buildTwbx re-injects it) and any stray dataapp.json (we rebuild it below from the .twb bindings).
  const files: DataAppFileInput[] = [];
  for (const [path, content] of Object.entries(archive)) {
    if (!path.startsWith(contentPrefix)) {
      continue;
    }
    const rel = path.slice(contentPrefix.length);
    if (rel.length === 0 || rel === EXTENSIONS_LIB_PATH || rel === DATA_APP_MANIFEST_PATH) {
      continue;
    }
    // Preserve raw bytes verbatim so binary assets (png/woff/…) survive the round trip exactly.
    files.push({ path: rel, content });
  }

  const datasources = parseDatasourceBindings(twbXml);

  // Rebuild the tool-managed manifest from the recovered identity + bindings, byte-for-byte in the
  // same shape scaffold writes (buildDataAppManifest + trailing newline), so downstream tools and a
  // subsequent buildWorkspaceTwbx read exactly what they would after a fresh scaffold.
  const manifest = buildDataAppManifest({
    appName,
    packageId,
    template: LIVE_EXTENSION_TEMPLATE,
    datasources,
  });
  files.push({
    path: DATA_APP_MANIFEST_PATH,
    content: `${JSON.stringify(manifest, null, 2)}\n`,
  });

  return { appName, packageId, datasources, files };
}

// Reverse of buildTwbx's columnMeta(): map the lowercase workbook `datatype` attribute back to the
// VDS-flavored DataAppFieldDataType enum. Unknown/absent types fall back to STRING (the verified
// path), matching columnMeta's own default branch so a round trip is stable.
function reverseDatatype(datatype: string | null | undefined): DataAppFieldDataType {
  switch ((datatype ?? '').toLowerCase()) {
    case 'integer':
      return 'INTEGER';
    case 'real':
      return 'REAL';
    case 'boolean':
      return 'BOOLEAN';
    case 'date':
      return 'DATE';
    case 'datetime':
      return 'DATETIME';
    case 'string':
    default:
      return 'STRING';
  }
}

/**
 * Recover the published-datasource bindings from the workbook XML's `<datasources>` block. Only
 * datasources that carry a `<repository-location>` (the published-datasource marker buildTwbx emits)
 * are considered; a datasource missing an identity (no sqlproxy connection name, contentUrl, or host
 * field) is skipped rather than yielding a half-formed binding. Returns an empty list when the app
 * wired no datasources (a degenerate but valid extension-only workbook).
 */
export function parseDatasourceBindings(twbXml: string): DataAppDatasourceBinding[] {
  if (/<!DOCTYPE/i.test(twbXml)) {
    throw new WorkbookDataAppNotFoundError(
      'The workbook XML declares a DOCTYPE and was not processed.',
    );
  }

  let doc: Document;
  try {
    const parser = new DOMParser({
      onError: (level, msg) => {
        if (level === 'warning') {
          return;
        }
        throw new Error(msg);
      },
    });
    doc = parser.parseFromString(twbXml, 'text/xml') as unknown as Document;
  } catch {
    throw new WorkbookDataAppNotFoundError(
      'The workbook XML could not be parsed, so its data sources cannot be recovered.',
    );
  }

  // The <workbook> root declares only a prefixed namespace (xmlns:user), so all of these elements are
  // in NO namespace and plain xpath selects them directly (same pattern as calcFieldNames.ts).
  const dsNodes = xpath.select(
    '/workbook/datasources/datasource[repository-location]',
    doc as unknown as Node,
  ) as Element[];

  const bindings: DataAppDatasourceBinding[] = [];
  for (const ds of dsNodes) {
    const caption = attr(ds, 'caption');
    const sqlproxyName = attr(ds, 'name');

    const repo = selectFirst('repository-location', ds);
    const conn = selectFirst("connection[@class='sqlproxy']", ds);
    // contentUrl is the repository-location id; the sqlproxy dbname is the same value (fallback).
    const contentUrl = attr(repo, 'id') || attr(conn, 'dbname');
    const host = attr(conn, 'server');
    const port = attr(conn, 'port');

    // buildTwbx emits exactly one datasource-level <column> (the placed host-sheet field). Its name is
    // bracket-wrapped ([field]); strip the brackets to recover the logical VDS fieldName.
    const col = selectFirst('column', ds);
    const rawName = attr(col, 'name');
    const fieldName = rawName.replace(/^\[/, '').replace(/\]$/, '');
    const fieldCaption = attr(col, 'caption') || fieldName;
    const dataType = reverseDatatype(attr(col, 'datatype'));

    if (!sqlproxyName || !contentUrl || !fieldName) {
      // Not a recoverable data-app datasource reference — skip rather than emit a partial binding.
      continue;
    }

    bindings.push({
      luid: '', // Not present in the workbook; the builder never reads it and the app resolves live.
      contentUrl,
      name: caption || contentUrl,
      sqlproxyName,
      host,
      port,
      field: { fieldName, caption: fieldCaption, dataType },
    });
  }

  return bindings;
}

function selectFirst(expression: string, context: Element): Element | null {
  return (xpath.select1(expression, context as unknown as Node) as Element | null) ?? null;
}

// Attribute read that tolerates a null element and normalizes a missing attribute to ''.
function attr(element: Element | null, name: string): string {
  return element?.getAttribute(name) ?? '';
}
