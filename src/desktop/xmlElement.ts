// Minimal element-slice / element-splice helpers over TWB XML strings, so a client
// with no local filesystem can read ONE worksheet/dashboard element out of a cached
// file and splice a modified version back in — without ever pulling the whole (large)
// document into the conversation. Tableau's <worksheet> / <dashboard> elements never
// nest another element of the same tag, so a lazy "opening tag → next matching close
// tag" scan is unambiguous for them.

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type ElementMatch = { start: number; end: number; text: string };

/**
 * Locate a `<tagName ... name="name" ...>...</tagName>` element. Returns its byte-agnostic
 * string offsets and text, or null when absent. `\b` after the tag name prevents matching a
 * different tag that shares a prefix (e.g. `<worksheets>` when asked for `<worksheet>`).
 */
export function findElement(xml: string, tagName: string, name: string): ElementMatch | null {
  const openRe = new RegExp(
    `<${escapeRegExp(tagName)}\\b[^>]*\\bname\\s*=\\s*(['"])${escapeRegExp(name)}\\1[^>]*>`,
    'i',
  );
  const open = openRe.exec(xml);
  if (!open) {
    return null;
  }

  const start = open.index;
  const closeTag = `</${tagName}>`;
  const closeIdx = xml.indexOf(closeTag, start + open[0].length);
  if (closeIdx === -1) {
    return null;
  }

  const end = closeIdx + closeTag.length;
  return { start, end, text: xml.slice(start, end) };
}

/**
 * Replace the `<tagName name="name">...</tagName>` element with `replacement`, leaving the
 * rest of the document byte-for-byte intact. Returns null when the element is absent.
 */
export function replaceElement(
  xml: string,
  tagName: string,
  name: string,
  replacement: string,
): string | null {
  const match = findElement(xml, tagName, name);
  if (!match) {
    return null;
  }
  return xml.slice(0, match.start) + replacement + xml.slice(match.end);
}

/** UTF-8 byte-accurate slice [startByte, endByte) of `content`. */
export function sliceBytes(content: string, startByte?: number, endByte?: number): string {
  const buf = Buffer.from(content, 'utf8');
  const start = startByte ?? 0;
  const end = endByte ?? buf.length;
  return buf.subarray(start, end).toString('utf8');
}
