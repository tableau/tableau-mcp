// Minimal element-slice / element-splice helpers over TWB XML strings, so a client
// with no local filesystem can read ONE worksheet/dashboard element out of a cached
// file and splice a modified version back in — without ever pulling the whole (large)
// document into the conversation. Tableau's <worksheet> / <dashboard> elements never
// nest another element of the same tag, so a lazy "opening tag → next matching close
// tag" scan is unambiguous for them.

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Decode the XML entities that appear in a serialized attribute value back to the
 * plain text a selector carries. Selectors are plain names (`Sales & Profit`) while
 * the serialized attribute is escaped (`Sales &amp; Profit`), so the attribute must
 * be decoded before it can be compared against a selector. `&amp;` is decoded LAST so
 * a doubly-escaped sequence like `&amp;lt;` resolves to the literal `&lt;`, not `<`.
 */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

export type ElementMatch = { start: number; end: number; text: string };

/**
 * Locate a `<tagName ... name="name" ...>...</tagName>` element. Returns its byte-agnostic
 * string offsets and text, or null when absent. `\b` after the tag name prevents matching a
 * different tag that shares a prefix (e.g. `<worksheets>` when asked for `<worksheet>`).
 *
 * The `name` selector is plain text; the serialized attribute is XML-escaped, so each
 * candidate's captured attribute value is entity-decoded and compared by string equality
 * (this also makes a name containing regex metacharacters match without escaping). The tag
 * name is still regex-escaped to guard against metacharacters in the tag.
 */
export function findElement(xml: string, tagName: string, name: string): ElementMatch | null {
  const openRe = new RegExp(
    `<${escapeRegExp(tagName)}\\b[^>]*?\\bname\\s*=\\s*(['"])(.*?)\\1[^>]*>`,
    'gi',
  );
  let open: RegExpExecArray | null;
  while ((open = openRe.exec(xml)) !== null) {
    if (decodeXmlEntities(open[2]) !== name) {
      continue;
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
  return null;
}

/**
 * Parse the first (outer) element of an XML fragment: its tag name and entity-decoded
 * `name` attribute (`null` when the outer element has no `name`). Returns `null` when no
 * opening element tag is found. A leading `<?xml …?>` declaration or `<!-- … -->` comment
 * is skipped because the tag-name character class excludes `?` and `!`. Used to verify a
 * splice replacement matches its selector before overwriting a file.
 */
export function parseOuterElement(xml: string): { tagName: string; name: string | null } | null {
  const open = /<([A-Za-z_][\w.:-]*)\b([^>]*)>/.exec(xml);
  if (!open) {
    return null;
  }
  const tagName = open[1];
  const nameAttr = /\bname\s*=\s*(['"])(.*?)\1/.exec(open[2]);
  const name = nameAttr ? decodeXmlEntities(nameAttr[2]) : null;
  return { tagName, name };
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
