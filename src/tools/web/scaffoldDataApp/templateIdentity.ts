import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';

/**
 * Single source of truth for turning a `datappName` into a data app's identity
 * (package id / display name) and for describing how the committed
 * placeholder template becomes a named workspace.
 *
 * Both output paths (local disk and S3) serve the same static, un-substituted
 * template zip and return the identical `postUnzip` plan (see
 * `buildPostUnzipPlan`) describing the edits/renames for the client to apply
 * after unzipping. They differ only in transport, not in how substitution
 * happens.
 */

/** Placeholder names present in the committed template tree. */
export const TEMPLATE_ROOT_DIRNAME = 'Data App Name';
export const TEMPLATE_TWB_FILENAME = 'Data App Name.twb';
export const TEMPLATE_PACKAGE_DIRNAME = 'TODO-MANIFEST-ID';

/** POSIX paths (relative to the template root dir) of the files carrying identity tokens. */
export const TWB_RELPATH = TEMPLATE_TWB_FILENAME;
export const TREX_RELPATH = `Packages/${TEMPLATE_PACKAGE_DIRNAME}/extensions/data-app.trex`;
/**
 * The package's JSON manifest. Its `id`/`version`/`name`/`author` are filled from the same identity
 * as the .trex, so the two never disagree; `requestedOrigins` ships empty (a space-separated origin
 * list when set) and is left for the author to fill in.
 */
export const MANIFEST_RELPATH = `Packages/${TEMPLATE_PACKAGE_DIRNAME}/manifest.json`;

/**
 * Literal placeholder tokens embedded in the committed template. The package id and
 * display name tokens appear across the .twb, data-app.trex, and manifest.json; the manifest id token
 * (`TODO-MANIFEST-ID`) is also the package directory name. The version token appears in all three
 * files; the author token in data-app.trex and manifest.json. The sheet name token appears only in the .twb
 * (worksheet/window/referenced-view name), so the worksheet tab reflects the app's display name
 * instead of a hardcoded "Sheet 1".
 */
const PLACEHOLDER_PACKAGE_ID = 'TODO-MANIFEST-ID';
const PLACEHOLDER_DISPLAY_NAME = 'TODO App Name';
const PLACEHOLDER_SHEET_NAME = 'TODO Sheet Name';
const PLACEHOLDER_VERSION = 'TODO-MANIFEST-VERSION';
const PLACEHOLDER_AUTHOR = 'TODO Author Name';
const PLACEHOLDER_SOURCE_BUILD = 'TODO-SOURCE-BUILD';

/** Every scaffolded app starts at this version, authored as this name. */
export const DEFAULT_VERSION = '1.0.0';
export const DEFAULT_AUTHOR = 'Tableau MCP';

export interface Replacement {
  find: string;
  replace: string;
}

export interface FileEdit {
  /** Path relative to the unzip directory (includes the template root dir prefix). */
  file: string;
  replacements: Replacement[];
}

export interface Rename {
  /** Path relative to the unzip directory. */
  from: string;
  to: string;
}

export interface PostUnzipPlan {
  instructions: string;
  edits: FileEdit[];
  renames: Rename[];
}

/** Where and how to declare the app's external origins once the workspace is finalized. */
export interface RequestedOriginsGuide {
  /** The finalized manifest.json, relative to the unzip directory (i.e. after `postUnzip`). */
  file: string;
  instructions: string;
}

export interface DataAppIdentity {
  packageId: string;
  displayName: string;
  version: string;
  author: string;
}

/**
 * Filesystem- and package-id-safe slug: lowercase, every run of non-alphanumeric
 * characters collapses to a single hyphen, leading/trailing hyphens trimmed. An
 * empty result (a name with no alphanumeric characters) falls back to "app".
 */
export function slug(name: string): string {
  const slugged = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slugged || 'app';
}

/**
 * Derives the data app identity from the requested name. `displayName` is the
 * name verbatim; `packageId` is a deterministic `com.tableau.mcp.<slug>`; `version`
 * and `author` are the fixed defaults.
 */
export function deriveIdentity(datappName: string): DataAppIdentity {
  return {
    packageId: `com.tableau.mcp.${slug(datappName)}`,
    displayName: datappName,
    version: DEFAULT_VERSION,
    author: DEFAULT_AUTHOR,
  };
}

/**
 * Escapes a value for insertion into XML (.twb, .trex). Escapes quotes too, not just the three
 * element-text-minimum characters, so this stays safe if a placeholder ever ends up inside an
 * attribute value instead of element text — no need to track where callers use the result.
 */
function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Escapes a value for insertion between the quotes of a JSON string literal (manifest.json). */
function escapeJsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * The literal find/replace edits, keyed by the file's POSIX path relative to the
 * template root dir. Consumed by `buildPostUnzipPlan` to build the plan both
 * output modes return; the client applies the edits after unzipping.
 *
 * `displayName` is user-supplied and inserted verbatim, so it (and `author`) is XML-escaped for
 * the .twb/.trex and JSON-escaped for manifest.json. `packageId` (a slug) and `version` contain no
 * characters needing escaping.
 */
export function buildTextReplacements(
  identity: DataAppIdentity,
  productVersion: ProductVersion,
): Record<string, Replacement[]> {
  const displayNameXml = escapeXmlText(identity.displayName);
  return {
    [TWB_RELPATH]: [
      {
        find: PLACEHOLDER_SOURCE_BUILD,
        replace: escapeXmlText(`${productVersion.value} (${productVersion.build})`),
      },
      { find: PLACEHOLDER_PACKAGE_ID, replace: identity.packageId },
      { find: PLACEHOLDER_DISPLAY_NAME, replace: displayNameXml },
      { find: PLACEHOLDER_SHEET_NAME, replace: displayNameXml },
      { find: PLACEHOLDER_VERSION, replace: identity.version },
    ],
    [TREX_RELPATH]: [
      { find: PLACEHOLDER_PACKAGE_ID, replace: identity.packageId },
      { find: PLACEHOLDER_DISPLAY_NAME, replace: displayNameXml },
      { find: PLACEHOLDER_VERSION, replace: identity.version },
      { find: PLACEHOLDER_AUTHOR, replace: escapeXmlText(identity.author) },
    ],
    [MANIFEST_RELPATH]: [
      { find: PLACEHOLDER_PACKAGE_ID, replace: identity.packageId },
      { find: PLACEHOLDER_DISPLAY_NAME, replace: escapeJsonString(identity.displayName) },
      { find: PLACEHOLDER_VERSION, replace: identity.version },
      { find: PLACEHOLDER_AUTHOR, replace: escapeJsonString(identity.author) },
    ],
  };
}

/**
 * The plan both paths return so the client can finalize the workspace after
 * unzipping the static, un-substituted template: apply every `edits` entry
 * first, then the `renames` in order (deepest paths first, the root dir last).
 * Paths are relative to the unzip directory and include the template root dir.
 */
export function buildPostUnzipPlan(
  identity: DataAppIdentity,
  productVersion: ProductVersion,
): PostUnzipPlan {
  const root = TEMPLATE_ROOT_DIRNAME;
  const edits: FileEdit[] = Object.entries(buildTextReplacements(identity, productVersion)).map(
    ([relPath, replacements]) => ({ file: `${root}/${relPath}`, replacements }),
  );
  const renames: Rename[] = [
    {
      from: `${root}/Packages/${TEMPLATE_PACKAGE_DIRNAME}`,
      to: `${root}/Packages/${identity.packageId}`,
    },
    { from: `${root}/${TEMPLATE_TWB_FILENAME}`, to: `${root}/${identity.displayName}.twb` },
    { from: root, to: identity.displayName },
  ];
  return {
    instructions:
      'Finalize the workspace after unzipping: first apply every `edits` entry (a literal find/replace on the file at `file`), then apply `renames` in order. Every path is relative to the unzip directory.',
    edits,
    renames,
  };
}

/**
 * Authoring guidance for manifest.json's `requestedOrigins`, returned beside `allowedOrigins`
 * rather than in `postUnzip`: the plan stays a purely mechanical finalize step, and this is
 * something the author does afterwards, once they know what the app fetches.
 */
export function buildRequestedOriginsGuide(identity: DataAppIdentity): RequestedOriginsGuide {
  return {
    file: `${identity.displayName}/Packages/${identity.packageId}/manifest.json`,
    instructions:
      '`requestedOrigins` in this manifest is scaffolded empty. If the app fetches from external origins, set it to a space-separated list of them (e.g. "https://api.example.com https://cdn.example.com"). Each one should also be in `allowedOrigins`.',
  };
}
