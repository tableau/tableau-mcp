// Asset-reference check run against the EXACT set of files that will be packaged.
//
// This closes the gap that buildTwbx's contentExtensionWarnings CANNOT see: contentExtensionWarnings
// only inspects files that are PRESENT in the bundle (it flags a bundled file whose extension is off
// the serve-time allow-list). It has no way to notice that an HTML or CSS file REFERENCES a local
// asset (src/href/url()) that was never packaged — that asset simply 404s at serve time and the
// dashboard renders blank. We scan every packaged HTML and CSS file for local references, resolve
// each reference RELATIVE TO THE REFERRING FILE, and warn about any target that is not itself part
// of the package.
//
// It is a best-effort textual heuristic, not an HTML/CSS parser, and it never throws: a validator
// must degrade to "no extra warnings" rather than fail on weird markup.

/** A file that will be written into the package's content/ directory. Path is content-relative. */
export type PackagedFile = { path: string; content: Uint8Array | string };

// HTML src/href values may be double-quoted, single-quoted, or valid unquoted attribute values.
// Requiring whitespace or `<` before the attribute name avoids treating `data-src` as `src`.
const ATTR_REF = /(?:^|[\s<])(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
// CSS url(...) with optional quotes. Group 1 is the (possibly quoted) target.
const CSS_URL = /url\(\s*("[^"]*"|'[^']*'|[^)]*)\s*\)/gi;

// Any RFC 3986 URI scheme (`scheme ":"`, e.g. `https:`, `data:`, `mailto:`, `tel:`, `sms:`, `blob:`,
// `about:`, `ftp:`, `javascript:`, and the platform's own `tableaulocalext:`) addresses a resource
// outside this package's content/ directory — it is never something we resolve/package, so it is
// not a hard reference failure. A bare relative path never matches this: RFC 3986 requires the
// scheme to start with a letter, and a path segment containing a literal colon before any slash is
// vanishingly rare and still safely treated as non-local rather than misresolved.
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

// A reference we do not treat as a local packaged asset: any URI-scheme reference (see above),
// protocol-relative (`//host/...`), and in-page hash anchors.
function isNonLocal(target: string): boolean {
  return target.startsWith('//') || target.startsWith('#') || URI_SCHEME.test(target);
}

// Strip surrounding quotes and drop any ?query or #fragment suffix from a raw reference.
function stripQuotesAndSuffix(raw: string): string {
  let t = raw.trim().replace(/^['"]|['"]$/g, '');
  const cut = t.search(/[?#]/);
  if (cut !== -1) {
    t = t.slice(0, cut);
  }
  return t;
}

// Normalize a content-relative packaged path (drop a leading ./, collapse duplicate slashes).
function normalizePackagePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/\/+/g, '/');
}

type ResolvedTarget = { path: string } | { error: string };

// Resolve as a browser request path: percent-decode each segment, normalize decoded dot segments,
// remove query/hash before this function is called, and resolve relative to the referring file.
// Traversal above the package root and malformed/ambiguous encodings are hard reference failures.
function resolveAgainst(referringPath: string, target: string): ResolvedTarget {
  const slash = referringPath.lastIndexOf('/');
  const fromDir = slash === -1 ? '' : referringPath.slice(0, slash);

  const rootRelative = target.startsWith('/');
  const stack: string[] = rootRelative || fromDir === '' ? [] : fromDir.split('/');

  for (const encodedSegment of target.replace(/^\//, '').split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(encodedSegment);
    } catch {
      return { error: `reference '${target}' has malformed percent encoding` };
    }
    if (segment.includes('/') || segment.includes('\\') || segment.includes('\0')) {
      return { error: `reference '${target}' contains an unsafe encoded path separator` };
    }
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (stack.length === 0) {
        return { error: `reference '${target}' escapes package root` };
      }
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return { path: stack.join('/') };
}

function toText(content: Uint8Array | string): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

function hasExtension(path: string, exts: string[]): boolean {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return path.includes('.') && exts.includes(ext);
}

/**
 * Scan every packaged HTML/CSS file for local src/href/url() references and return one warning per
 * referenced-but-unpackaged local target. References are resolved relative to the referring file, so
 * a `url(../img/bg.png)` inside `src/styles.css` is checked as `img/bg.png`. Never throws.
 */
export function assetReferenceCheck(files: PackagedFile[]): string[] {
  const packaged = new Set<string>(files.map((f) => normalizePackagePath(f.path)));
  const warnings: string[] = [];
  const seen = new Set<string>();

  const consider = (referringPath: string, rawTarget: string | undefined): void => {
    if (!rawTarget) {
      return;
    }
    const unquoted = stripQuotesAndSuffix(rawTarget);
    if (unquoted.length === 0 || isNonLocal(unquoted)) {
      return;
    }
    const resolution = resolveAgainst(referringPath, unquoted);
    if ('error' in resolution) {
      const key = `error:${resolution.error}`;
      if (!seen.has(key)) {
        seen.add(key);
        warnings.push(
          `${resolution.error} — local asset reference is unsafe and cannot be packaged.`,
        );
      }
      return;
    }
    const resolved = resolution.path;
    if (resolved.length === 0 || packaged.has(resolved) || seen.has(resolved)) {
      return;
    }
    seen.add(resolved);
    warnings.push(
      `referenced asset '${resolved}' is not packaged — it will 404 at serve time and render ` +
        'blank in Tableau. Add it to the workspace, or make the reference absolute (http/https).',
    );
  };

  for (const file of files) {
    const path = normalizePackagePath(file.path);
    const isHtml = hasExtension(path, ['html', 'htm']);
    const isCss = hasExtension(path, ['css']);
    if (!isHtml && !isCss) {
      continue;
    }
    const text = toText(file.content);
    if (isHtml) {
      for (const m of text.matchAll(ATTR_REF)) {
        consider(path, m[1] ?? m[2] ?? m[3]);
      }
    }
    // Both HTML (inline <style>/style="url(...)") and CSS files can carry url() references.
    for (const m of text.matchAll(CSS_URL)) {
      consider(path, m[1]);
    }
  }

  return warnings;
}
