/**
 * Single source of truth for turning a `datappName` into a data app's identity
 * (package id / author / display name) and for describing how the committed
 * placeholder template becomes a named workspace.
 *
 * Both delivery paths depend on this module so they stay in lockstep:
 *  - the local (stdio) writer rewrites files on disk as it copies the template;
 *  - the remote (http) path returns a `postUnzip` plan describing the exact same
 *    edits/renames for the client to apply after unzipping the static template.
 */

/** Placeholder names present in the committed template tree. */
export const TEMPLATE_ROOT_DIRNAME = 'Data App Name';
export const TEMPLATE_TWB_FILENAME = 'Data App Name.twb';
export const TEMPLATE_PACKAGE_DIRNAME = 'PackageId';

/** POSIX paths (relative to the template root dir) of the files carrying identity tokens. */
export const MANIFEST_RELPATH = `Packages/${TEMPLATE_PACKAGE_DIRNAME}/manifest.json`;
export const TREX_RELPATH = `Packages/${TEMPLATE_PACKAGE_DIRNAME}/extensions/data-app.trex`;

/** Literal placeholder tokens embedded in the committed manifest.json / data-app.trex. */
const PLACEHOLDER_PACKAGE_ID = 'com.example.name';
const PLACEHOLDER_DISPLAY_NAME = '<TODO Name>';
const PLACEHOLDER_AUTHOR = '<TODO Username> via Tableau MCP';
const PLACEHOLDER_TREX_ID = '<TODO-manifest-id>';

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

export interface DataAppIdentity {
  packageId: string;
  author: string;
  displayName: string;
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
 * Reduces a username to a value that is safe to embed verbatim in both a JSON
 * string (manifest.json) and an XML attribute (data-app.trex) without escaping:
 * disallowed characters (including quotes and angle brackets) collapse to a
 * single space; the result is trimmed.
 */
function sanitizeUsername(username: string | undefined): string {
  if (!username) {
    return '';
  }
  return username.replace(/[^A-Za-z0-9 ._@-]+/g, ' ').trim();
}

/**
 * Derives the data app identity from the requested name and (optional) auth
 * username. `displayName` is the name verbatim; `packageId` is a deterministic
 * `com.tableau.mcp.<slug>`; `author` is "<username> via Tableau MCP", falling
 * back to "Tableau MCP" when no username is available.
 */
export function deriveIdentity(datappName: string, username?: string): DataAppIdentity {
  const cleanUsername = sanitizeUsername(username);
  return {
    packageId: `com.tableau.mcp.${slug(datappName)}`,
    author: cleanUsername ? `${cleanUsername} via Tableau MCP` : 'Tableau MCP',
    displayName: datappName,
  };
}

/**
 * The literal find/replace edits, keyed by the file's POSIX path relative to the
 * template root dir. Consumed by the local writer (applied while copying) and by
 * the remote plan (embedded for the client to apply).
 */
export function buildTextReplacements(identity: DataAppIdentity): Record<string, Replacement[]> {
  return {
    [MANIFEST_RELPATH]: [
      { find: PLACEHOLDER_PACKAGE_ID, replace: identity.packageId },
      { find: PLACEHOLDER_DISPLAY_NAME, replace: identity.displayName },
      { find: PLACEHOLDER_AUTHOR, replace: identity.author },
    ],
    [TREX_RELPATH]: [
      { find: PLACEHOLDER_TREX_ID, replace: identity.packageId },
      { find: PLACEHOLDER_AUTHOR, replace: identity.author },
    ],
  };
}

/** Applies literal (non-regex) find/replace edits in order. */
export function applyReplacements(content: string, replacements: Replacement[]): string {
  return replacements.reduce((acc, { find, replace }) => acc.split(find).join(replace), content);
}

/**
 * Maps a template file's POSIX path (relative to the template root dir) to its
 * final path within the finished workspace: the `.twb` is renamed to the display
 * name and the package dir is renamed to the package id. All other paths are
 * unchanged. Used by the local writer to place each copied file directly at its
 * final location.
 */
export function mapToFinalRelativePath(relPath: string, identity: DataAppIdentity): string {
  if (relPath === TEMPLATE_TWB_FILENAME) {
    return `${identity.displayName}.twb`;
  }
  const packagePrefix = `Packages/${TEMPLATE_PACKAGE_DIRNAME}/`;
  if (relPath.startsWith(packagePrefix)) {
    return `Packages/${identity.packageId}/${relPath.slice(packagePrefix.length)}`;
  }
  return relPath;
}

/**
 * The plan the remote (http) path returns so the client can finalize the
 * workspace after unzipping the static template: apply every `edits` entry
 * first, then the `renames` in order (deepest paths first, the root dir last).
 * Paths are relative to the unzip directory and include the template root dir.
 */
export function buildPostUnzipPlan(identity: DataAppIdentity): PostUnzipPlan {
  const root = TEMPLATE_ROOT_DIRNAME;
  const edits: FileEdit[] = Object.entries(buildTextReplacements(identity)).map(
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
