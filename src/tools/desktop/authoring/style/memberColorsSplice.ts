import { escapeXml } from '../../../../desktop/binder/escape.js';
import { decodeXmlEntities } from '../../../../desktop/xmlElement.js';

export type Bucket = { member: string; bucket: string; color: string };

// Element text only: attribute values go through escapeXml.
function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Splits `[ds].[instance]`; a bare `[instance]` has no datasource. */
export function splitColumnRef(ref: string): { datasource?: string; instance: string } {
  const match = ref.match(/^\[((?:[^\]]|\]\])*)\]\.(\[.*\])$/);
  return match === null ? { instance: ref } : { datasource: match[1], instance: match[2] };
}

// String edits, not parse-and-reserialize: the rest of the datasource document must stay
// byte-for-byte what Desktop gave us, which the XML parser helpers do not guarantee.
type Element = {
  name: string;
  start: number;
  openEnd: number;
  /** Start of the close tag, or `end` when self-closing. */
  closeStart: number;
  end: number;
  selfClosing: boolean;
};

const TAG = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>'"]|'[^']*'|"[^"]*")*?)(\/?)>/y;
const OPAQUE_SECTIONS = [
  ['<!--', '-->'],
  ['<![CDATA[', ']]>'],
  ['<?', '?>'],
] as const;

/** Direct child elements of `parent`, or the document's root element when parent is omitted. */
function childElements(xml: string, parent?: Element): Element[] {
  const to = parent === undefined ? xml.length : parent.closeStart;
  const found: Element[] = [];
  const stack: Array<{ name: string; start: number; openEnd: number }> = [];
  let cursor = parent === undefined ? 0 : parent.openEnd;
  while (cursor < to) {
    const next = xml.indexOf('<', cursor);
    if (next === -1 || next >= to) break;
    const opaque = OPAQUE_SECTIONS.find(([open]) => xml.startsWith(open, next));
    if (opaque !== undefined) {
      const close = xml.indexOf(opaque[1], next + opaque[0].length);
      cursor = close === -1 ? to : close + opaque[1].length;
      continue;
    }
    TAG.lastIndex = next;
    const match = TAG.exec(xml);
    if (match === null) {
      cursor = next + 1;
      continue;
    }
    const end = next + match[0].length;
    const [, closing, name, , selfClose] = match;
    if (closing) {
      const open = stack.pop();
      if (open !== undefined && stack.length === 0) {
        found.push({ ...open, closeStart: next, end, selfClosing: false });
      }
    } else if (selfClose) {
      if (stack.length === 0) {
        found.push({ name, start: next, openEnd: end, closeStart: end, end, selfClosing: true });
      }
    } else {
      stack.push({ name, start: next, openEnd: end });
    }
    cursor = end;
  }
  return found;
}

function openTagOf(xml: string, element: Element): string {
  return xml.slice(element.start, element.openEnd);
}

export function attrOf(openTag: string, name: string): string | undefined {
  const match = openTag.match(new RegExp(`\\s${name}=(?:'([^']*)'|"([^"]*)")`));
  const raw = match?.[1] ?? match?.[2];
  return raw === undefined ? undefined : decodeXmlEntities(raw);
}

function replaceRange(xml: string, start: number, end: number, text: string): string {
  return xml.slice(0, start) + text + xml.slice(end);
}

function mapsXml(buckets: readonly Bucket[]): string {
  const byColor = new Map<string, string[]>();
  for (const { bucket, color } of buckets) {
    byColor.set(color, [...(byColor.get(color) ?? []), bucket]);
  }
  return [...byColor]
    .map(
      ([color, list]) =>
        `<map to='${color}'>${list
          .map((bucket) => `<bucket>${escapeText(bucket)}</bucket>`)
          .join('')}</map>`,
    )
    .join('');
}

function rewriteEncoding(xml: string, encoding: Element, buckets: readonly Bucket[]): string {
  const requested = new Set(buckets.map(({ bucket }) => bucket));
  const kept: string[] = [];
  if (!encoding.selfClosing) {
    let cursor = encoding.openEnd;
    for (const child of childElements(xml, encoding)) {
      kept.push(xml.slice(cursor, child.start));
      cursor = child.end;
      if (child.name !== 'map') {
        kept.push(xml.slice(child.start, child.end));
        continue;
      }
      const survivors = childElements(xml, child).filter(
        (bucket) =>
          !(
            bucket.name === 'bucket' &&
            requested.has(decodeXmlEntities(xml.slice(bucket.openEnd, bucket.closeStart)).trim())
          ),
      );
      if (survivors.length > 0) {
        kept.push(
          openTagOf(xml, child) +
            survivors.map((bucket) => xml.slice(bucket.start, bucket.end)).join('') +
            '</map>',
        );
      }
    }
    kept.push(xml.slice(cursor, encoding.closeStart));
  }
  const open = openTagOf(xml, encoding).replace(/\s*\/>$/, '>');
  return `${open}${kept.join('')}${mapsXml(buckets)}</encoding>`;
}

function markRuleXml(inner: string): string {
  return `<style-rule element='mark'>${inner}</style-rule>`;
}

/**
 * Put the member colors into a datasource document: the field's column-instance (copied from
 * the worksheet when missing), a `<style>` after `<layout>`, and every color encoding for the
 * field. Returns undefined when the document is not a datasource.
 */
export function spliceMemberColors(
  datasourceXml: string,
  target: { instance: string; instanceXml: string },
  buckets: readonly Bucket[],
): string | undefined {
  let xml = datasourceXml;
  let root = childElements(xml)[0];
  if (root?.name !== 'datasource' || root.selfClosing) return undefined;

  let children = childElements(xml, root);
  const hasInstance = children.some(
    (element) =>
      element.name === 'column-instance' &&
      attrOf(openTagOf(xml, element), 'name') === target.instance,
  );
  if (!hasInstance) {
    const lastColumn = [...children]
      .reverse()
      .find((element) => element.name === 'column' || element.name === 'column-instance');
    const at = lastColumn?.end ?? root.openEnd;
    xml = replaceRange(xml, at, at, target.instanceXml);
    root = childElements(xml)[0];
    children = childElements(xml, root);
  }

  const style = children.find((element) => element.name === 'style');
  const newEncoding = `<encoding attr='color' field='${escapeXml(target.instance)}' type='palette'>${mapsXml(buckets)}</encoding>`;
  if (style === undefined) {
    const layout = children.find((element) => element.name === 'layout');
    const semantic = children.find((element) => element.name === 'semantic-values');
    const at = layout?.end ?? semantic?.start ?? root.closeStart;
    return replaceRange(xml, at, at, `<style>${markRuleXml(newEncoding)}</style>`);
  }
  if (style.selfClosing) {
    return replaceRange(xml, style.start, style.end, `<style>${markRuleXml(newEncoding)}</style>`);
  }

  const markRule = childElements(xml, style).find(
    (element) =>
      element.name === 'style-rule' && attrOf(openTagOf(xml, element), 'element') === 'mark',
  );
  if (markRule === undefined) {
    return replaceRange(xml, style.closeStart, style.closeStart, markRuleXml(newEncoding));
  }
  if (markRule.selfClosing) {
    return replaceRange(xml, markRule.start, markRule.end, markRuleXml(newEncoding));
  }

  const copies = childElements(xml, markRule).filter((element) => {
    if (element.name !== 'encoding') return false;
    const tag = openTagOf(xml, element);
    return (
      attrOf(tag, 'attr') === 'color' &&
      splitColumnRef(attrOf(tag, 'field') ?? '').instance === target.instance
    );
  });
  if (copies.length === 0) {
    return replaceRange(xml, markRule.closeStart, markRule.closeStart, newEncoding);
  }
  for (const copy of [...copies].reverse()) {
    xml = replaceRange(xml, copy.start, copy.end, rewriteEncoding(xml, copy, buckets));
  }
  return xml;
}

/** Bucket texts (e.g. `"Furniture"`) the datasource's color encodings hold for the field. */
export function existingBuckets(datasourceXml: string, instance: string): string[] | undefined {
  const root = childElements(datasourceXml)[0];
  const style = root && childElements(datasourceXml, root).find((e) => e.name === 'style');
  if (style === undefined || style.selfClosing) return undefined;
  const found = new Set<string>();
  for (const rule of childElements(datasourceXml, style)) {
    if (rule.name !== 'style-rule' || rule.selfClosing) continue;
    for (const encoding of childElements(datasourceXml, rule)) {
      const tag = openTagOf(datasourceXml, encoding);
      if (
        encoding.name !== 'encoding' ||
        encoding.selfClosing ||
        attrOf(tag, 'attr') !== 'color' ||
        splitColumnRef(attrOf(tag, 'field') ?? '').instance !== instance
      ) {
        continue;
      }
      for (const map of childElements(datasourceXml, encoding)) {
        if (map.name !== 'map' || map.selfClosing) continue;
        for (const bucket of childElements(datasourceXml, map)) {
          found.add(
            decodeXmlEntities(datasourceXml.slice(bucket.openEnd, bucket.closeStart)).trim(),
          );
        }
      }
    }
  }
  return found.size === 0 ? undefined : [...found];
}
