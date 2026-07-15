// Split-on-publish transform. The model contract (publishExitClause.ts) still tells the model to
// emit ONE self-contained inline artifact: a single index.html with inline <script>/<style>. This
// pure, server-side, model-invisible transform externalizes those inline blocks into sibling
// content/ files (app.js, styles.css, …) so the built .twbx contains real assets beside index.html
// instead of one giant inline document.
//
// It is a best-effort textual scanner, NOT a full HTML parser. Two hard rules govern it:
//   1. NEVER throw. Any error → no-op ({ html: <original>, assets: [] }). A failed/partial split
//      must never break a publish.
//   2. On ANY parse ambiguity for a given block, prefer leaving that block inline over risking
//      breakage. Externalizing is only done when the block is unambiguously safe to externalize.
//
// Design notes / documented deviations from the bare spec:
//   - HTML comments (`<!-- … -->`) are skipped verbatim (their contents are not scanned). Without
//     this, a commented-out `<script>…</script>` would be wrongly externalized. This is a pure
//     robustness addition consistent with rule 2 (prefer not breaking).

export interface SplitAsset {
  path: string;
  bytes: Uint8Array;
}

export interface SplitResult {
  html: string;
  assets: SplitAsset[];
}

// Executable classic-script types. An ABSENT type is also classic. Anything else (application/json,
// application/ld+json, importmap, text/template, text/html, speculationrules, unknown, …) is a DATA
// block and must be left inline — externalizing it would break it.
const CLASSIC_TYPES = new Set(['', 'text/javascript', 'application/javascript']);

// Find the raw-text end tag for a <script>/<style> body per the HTML spec: `</script`/`</style`
// counts as a close ONLY when the tag name is immediately followed by whitespace, `/`, or `>`. A
// bare substring match (e.g. `</scriptx>` inside a JS string) does NOT end the element in a browser,
// so skip it and keep looking. A match at end-of-string has no terminator → not a valid end tag.
// Returns the index of `<` of the terminating close tag, or -1 if none exists.
function findRawTextClose(lower: string, needle: string, from: number): number {
  let i = from;
  while ((i = lower.indexOf(needle, i)) !== -1) {
    const next = lower[i + needle.length];
    if (next === '/' || next === '>' || (next !== undefined && /\s/.test(next))) {
      return i;
    }
    i += needle.length;
  }
  return -1;
}

// Find the index of the '>' that closes the tag starting at `start`, respecting quoted attribute
// values (a '>' inside "…" / '…' does not close the tag). Returns -1 if none.
function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

// Parse the attributes out of an opening tag string like `<script type="module" src="x">`.
// Returns a lowercased-key map; a valueless attribute maps to ''. Never throws.
function parseAttrs(openTag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Drop the leading `<tagname` and the trailing `>` (and any self-closing `/`).
  const inner = openTag.replace(/^<[a-zA-Z][^\s/>]*/, '').replace(/\/?>?$/, '');
  const re = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++; // guard against a zero-width match looping forever
      continue;
    }
    attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  }
  return attrs;
}

export function splitInlineAssets(html: string, reservedPaths?: ReadonlySet<string>): SplitResult {
  try {
    const lower = html.toLowerCase();
    const assets: SplitAsset[] = [];
    let out = '';
    let cursor = 0;
    let svgDepth = 0;
    let classicCount = 0;
    let moduleCount = 0;
    let styleCount = 0;

    // Names already taken — caller-supplied asset paths plus anything we've already emitted. The
    // path allocators skip these so a transform-minted `<script src>`/`<link href>` always points at
    // the bytes we actually emit (never at an unrelated caller file).
    const taken = new Set<string>(reservedPaths ?? []);

    // Tokens of interest, scanned case-insensitively. Openers require a boundary char after the
    // name so `<scripting>`-style false hits are avoided.
    const tokenRe = /<!--|<script(?=[\s/>])|<style(?=[\s/>])|<svg(?=[\s/>])|<\/svg\s*>/gi;
    let m: RegExpExecArray | null;

    while ((m = tokenRe.exec(html)) !== null) {
      const start = m.index;
      const token = m[0].toLowerCase();
      out += html.slice(cursor, start);

      // HTML comment: skip its entire span verbatim, never scanning inside it.
      if (token === '<!--') {
        const end = lower.indexOf('-->', start + 4);
        if (end === -1) {
          // Unterminated comment: leave the rest of the document untouched.
          out += html.slice(start);
          cursor = html.length;
          break;
        }
        out += html.slice(start, end + 3);
        cursor = end + 3;
        tokenRe.lastIndex = cursor;
        continue;
      }

      // Closing </svg>: pop svg depth, copy verbatim.
      if (token.startsWith('</svg')) {
        svgDepth = Math.max(0, svgDepth - 1);
        out += html.slice(start, tokenRe.lastIndex);
        cursor = tokenRe.lastIndex;
        continue;
      }

      const tagEnd = findTagEnd(html, start);
      if (tagEnd === -1) {
        // Malformed opening tag (no closing '>'): leave the rest inline.
        out += html.slice(start);
        cursor = html.length;
        break;
      }
      const openTag = html.slice(start, tagEnd + 1);
      const selfClosing = /\/\s*>$/.test(openTag);

      // <svg …>: track depth so a nested <style> is recognized as scoped SVG CSS and skipped.
      if (token === '<svg') {
        if (!selfClosing) {
          svgDepth++;
        }
        out += openTag;
        cursor = tagEnd + 1;
        tokenRe.lastIndex = cursor;
        continue;
      }

      const isScript = token === '<script';
      const closeNeedle = isScript ? '</script' : '</style';

      // A self-closing <script/>/<style/> has no body — leave it inline as-is.
      if (selfClosing) {
        out += openTag;
        cursor = tagEnd + 1;
        tokenRe.lastIndex = cursor;
        continue;
      }

      // Body terminates at the FIRST boundaried case-insensitive </script> / </style> (the HTML
      // raw-text end-tag rule): the tag name must be followed by whitespace, `/`, or `>`, otherwise
      // it is not a close and the scan continues (see findRawTextClose).
      const bodyStart = tagEnd + 1;
      const closeIdx = findRawTextClose(lower, closeNeedle, bodyStart);
      const closeTagEnd = closeIdx === -1 ? -1 : html.indexOf('>', closeIdx);
      if (closeIdx === -1 || closeTagEnd === -1) {
        // No matching close tag: ambiguous → leave inline, resume scanning after the opening tag.
        out += openTag;
        cursor = bodyStart;
        tokenRe.lastIndex = cursor;
        continue;
      }

      const body = html.slice(bodyStart, closeIdx);
      const wholeBlock = html.slice(start, closeTagEnd + 1);
      const attrs = parseAttrs(openTag);

      let ref: string | null = null;
      let path: string | null = null;

      if (isScript) {
        const hasSrc = 'src' in attrs;
        const type = (attrs.type ?? '').trim().toLowerCase();
        // Externalizing rewrites the tag to bare `<script src=...>`, dropping every other attribute.
        // A nonce (CSP), id/data-* (document.currentScript), etc. must survive → leave inline.
        const hasExtraAttrs = Object.keys(attrs).some((k) => k !== 'type' && k !== 'src');
        if (svgDepth > 0) {
          // A <script> inside inline SVG is an SVG script element that loads via href/xlink:href,
          // NOT src — a rewritten <script src> would never execute. Leave it inline.
          ref = null;
        } else if (hasSrc) {
          // Already external — do not touch.
          ref = null;
        } else if (hasExtraAttrs) {
          // Would lose meaningful attributes on externalization: leave inline (rule 2).
          ref = null;
        } else if (CLASSIC_TYPES.has(type)) {
          do {
            classicCount++;
            path = classicCount === 1 ? 'app.js' : `app-${classicCount}.js`;
          } while (taken.has(path));
          ref = `<script src="${path}"></script>`;
        } else if (type === 'module') {
          do {
            moduleCount++;
            path = moduleCount === 1 ? 'app.mjs' : `app-${moduleCount}.mjs`;
          } while (taken.has(path));
          ref = `<script type="module" src="${path}"></script>`;
        } else {
          // Non-executable data block (json/importmap/template/…): leave inline.
          ref = null;
        }
      } else {
        // <style>. Skip if scoped inside an <svg>…</svg> range, or if it carries attributes beyond
        // `type` (e.g. media="print", title) that a bare <link> rewrite would drop (rule 2).
        const hasExtraAttrs = Object.keys(attrs).some((k) => k !== 'type');
        if (svgDepth === 0 && !hasExtraAttrs) {
          do {
            styleCount++;
            path = styleCount === 1 ? 'styles.css' : `styles-${styleCount}.css`;
          } while (taken.has(path));
          ref = `<link rel="stylesheet" href="${path}">`;
        } else {
          ref = null;
        }
      }

      if (ref !== null && path !== null) {
        out += ref;
        taken.add(path);
        assets.push({ path, bytes: new TextEncoder().encode(body) });
      } else {
        out += wholeBlock;
      }
      // Either way, consume the whole block so its inner text is never rescanned for tokens.
      cursor = closeTagEnd + 1;
      tokenRe.lastIndex = cursor;
    }

    // Nothing safely extractable → exact no-op with the ORIGINAL html (byte-identical).
    if (assets.length === 0) {
      return { html, assets: [] };
    }

    out += html.slice(cursor);
    return { html: out, assets };
  } catch {
    // Rule 1: a failed/partial split must never break a publish.
    return { html, assets: [] };
  }
}
