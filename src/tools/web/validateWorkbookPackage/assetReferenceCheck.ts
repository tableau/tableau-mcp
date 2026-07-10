// Heuristic asset-reference check for a workbook package's index.html.
//
// This closes the exact gap that buildTwbx's contentExtensionWarnings CANNOT see:
// contentExtensionWarnings only inspects files that are PRESENT in the bundle (it flags a bundled
// file whose extension is off the serve-time allow-list). It has no way to notice that the HTML
// REFERENCES a local asset (src/href/url()) that was never bundled — that asset simply 404s at
// serve time and the dashboard renders blank. We scan the HTML for local references and warn about
// any target that is not part of the bundle (index.html + the declared asset paths).
//
// It is a best-effort textual heuristic, not an HTML parser, and it never throws: a validator must
// degrade to "no extra warnings" rather than fail on weird markup.

// src="..." / href="..." (single or double quoted). Group 1 is the quoted target.
const ATTR_REF = /(?:src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi;
// CSS url(...) with optional quotes. Group 1 is the (possibly quoted) target.
const CSS_URL = /url\(\s*("[^"]*"|'[^']*'|[^)]*)\s*\)/gi;

// A reference we do not treat as a local bundled asset: remote, protocol-relative, data URIs,
// mailto, in-page hash anchors, and the platform's own tableaulocalext: scheme (rewritten at load
// time by the reader, not something we bundle).
function isNonLocal(target: string): boolean {
  return (
    /^https?:\/\//i.test(target) ||
    target.startsWith('//') ||
    /^data:/i.test(target) ||
    /^mailto:/i.test(target) ||
    target.startsWith('#') ||
    /^tableaulocalext:/i.test(target)
  );
}

// Normalize a raw reference to the path we compare against bundled paths: strip surrounding quotes,
// drop any ?query or #fragment suffix, and remove a single leading ./ or /.
function normalizeTarget(raw: string): string {
  let t = raw.trim().replace(/^['"]|['"]$/g, '');
  const cut = t.search(/[?#]/);
  if (cut !== -1) {
    t = t.slice(0, cut);
  }
  t = t.replace(/^\.\//, '').replace(/^\//, '');
  return t;
}

/**
 * Scan `html` for local src/href/url() references and return one warning per referenced-but-unbundled
 * local target. `assetPaths` are the paths (relative to content/) that WILL be bundled beside
 * index.html. Never throws.
 */
export function assetReferenceCheck(html: string, assetPaths: string[]): string[] {
  const bundled = new Set<string>(['index.html', ...assetPaths.map((p) => normalizeTarget(p))]);
  const warnings: string[] = [];
  const seen = new Set<string>();

  const consider = (rawTarget: string | undefined): void => {
    if (!rawTarget) {
      return;
    }
    const unquoted = rawTarget.trim().replace(/^['"]|['"]$/g, '');
    if (unquoted.length === 0 || isNonLocal(unquoted)) {
      return;
    }
    const target = normalizeTarget(unquoted);
    if (target.length === 0 || bundled.has(target) || seen.has(target)) {
      return;
    }
    seen.add(target);
    warnings.push(
      `referenced asset '${target}' is not bundled in the package — it will 404 at serve time and ` +
        'render blank in Tableau. Add it to `assets`, or make the reference absolute (http/https).',
    );
  };

  for (const m of html.matchAll(ATTR_REF)) {
    // m[2] = double-quoted body, m[3] = single-quoted body.
    consider(m[2] ?? m[3]);
  }
  for (const m of html.matchAll(CSS_URL)) {
    consider(m[1]);
  }

  return warnings;
}
