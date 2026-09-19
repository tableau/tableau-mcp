import { DOMParser, Element as XmlElement } from '@xmldom/xmldom';

/**
 * Classify a standalone `<worksheet>` XML fragment as `'blank'` (no shelved fields and no rows/cols
 * text), `'populated'`, or `'unknown'` (not a worksheet fragment, or missing its `<table>`).
 */
export function worksheetDocumentState(xml: string): 'blank' | 'populated' | 'unknown' {
  const doc = new DOMParser({ errorHandler: () => {} }).parseFromString(xml.trim(), 'text/xml');
  const worksheet = doc.documentElement;
  if (!worksheet || worksheet.tagName !== 'worksheet') return 'unknown';
  const table = directChild(worksheet, 'table');
  if (!table) return 'unknown';

  const rows = directChild(table, 'rows')?.textContent?.trim() ?? '';
  const cols = directChild(table, 'cols')?.textContent?.trim() ?? '';
  return rows === '' && cols === '' && !hasPlacedFieldReference(table) ? 'blank' : 'populated';
}

// A column-instance-style internal field token: `[<ns>:<name>:<suffix>]` (e.g. `[none:Category:nk]`,
// `[usr:Profit:qk]`). This is how a placed field is spelled in single-datasource form, on ANY shelf,
// encoding, sort, filter, or group attribute -- not only `column`/`*field`. A datasource declaration
// name like `[Sample - Superstore]` has no inner colons, so it does not match, keeping a blank sheet
// that carries only a datasource declaration classified as blank.
const INTERNAL_FIELD_TOKEN = /\[[a-z]+:[^\]]+:[a-z]{2,3}\]/i;

export function hasPlacedFieldReference(table: XmlElement): boolean {
  const stack = [table];
  while (stack.length > 0) {
    const element = stack.pop()!;
    // Datasource declarations can survive clearing a sheet; they do not prove chart content.
    if (
      element.tagName === 'datasources' ||
      element.tagName === 'datasource-dependencies' ||
      element.tagName === 'style'
    ) {
      continue;
    }

    for (let index = 0; index < element.attributes.length; index++) {
      const attribute = element.attributes.item(index);
      if (
        attribute &&
        // A fully-qualified `[Datasource].[field]` ref, or a placed ref named on the shelf-style
        // `column`/`*field` attributes, or a single-datasource internal field token on ANY attribute.
        (attribute.value.includes('].[') ||
          ((attribute.name === 'column' || attribute.name.endsWith('field')) &&
            attribute.value.includes('[')) ||
          INTERNAL_FIELD_TOKEN.test(attribute.value))
      ) {
        return true;
      }
    }
    for (let index = 0; index < element.childNodes.length; index++) {
      const child = element.childNodes.item(index);
      if (child?.nodeType === 1) {
        stack.push(child as XmlElement);
      } else if (child?.nodeValue?.includes('].[')) {
        return true;
      }
    }
  }
  return false;
}

function directChild(parent: XmlElement, tagName: string): XmlElement | undefined {
  for (let index = 0; index < parent.childNodes.length; index++) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType === 1 && (child as XmlElement).tagName === tagName) {
      return child as XmlElement;
    }
  }
  return undefined;
}
