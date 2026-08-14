import { createHash } from 'node:crypto';

import {
  Attr as XmlAttr,
  Document as XmlDocument,
  DOMParser,
  Element as XmlElement,
} from '@xmldom/xmldom';

type CanonicalNode = [kind: string, ...parts: unknown[]];

const PRESENTATION_FORMAT_ATTRIBUTES = new Set([
  'background',
  'border-color',
  'color',
  'fill',
  'font',
  'font-color',
  'font-face',
  'font-size',
  'font-weight',
  'margin',
  'padding',
  'text-align',
]);

const STYLE_CONTAINER_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  style: new Set(),
  'style-rule': new Set(['element']),
  'zone-style': new Set(),
};

const STYLE_OWNED_ELEMENT_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  zone: new Set(['h', 'w', 'x', 'y']),
  run: new Set([
    'bold',
    'fontalignment',
    'fontcolor',
    'fontname',
    'fontsize',
    'italic',
    'underline',
  ]),
};

export function analyticalFingerprint(xml: string): string {
  const document = parseWorkbook(xml);
  const root = document.documentElement;
  if (!root) throw new Error('Cannot fingerprint an empty workbook XML document');
  const canonical = canonicalizeElement(root, []);
  if (!canonical) throw new Error('Cannot fingerprint an empty workbook XML document');
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function parseWorkbook(xml: string): XmlDocument {
  let malformed = false;
  const parser = new DOMParser({
    onError: () => {
      malformed = true;
    },
  });
  let document: XmlDocument;
  try {
    document = parser.parseFromString(xml, 'text/xml');
  } catch {
    malformed = true;
    document = parser.parseFromString('<invalid/>', 'text/xml');
  }
  if (malformed) throw new Error('Cannot fingerprint malformed workbook XML');
  assertWorkbookRoot(document);
  return document;
}

function assertWorkbookRoot(document: XmlDocument): void {
  if (!isUnnamespacedNamed(document.documentElement, 'workbook')) {
    throw new Error('Analytical fingerprint requires a <workbook> XML document');
  }
}

function canonicalizeElement(
  element: XmlElement,
  ancestors: XmlElement[],
): CanonicalNode | undefined {
  if (isIgnoredPresentationFormat(element, ancestors)) return undefined;

  const attributes = Array.from({ length: element.attributes.length }, (_, index) =>
    element.attributes.item(index),
  )
    .filter((attribute): attribute is XmlAttr => Boolean(attribute))
    .filter((attribute) => !isNamespaceDeclaration(attribute))
    .filter((attribute) => !isStyleOwnedElementAttribute(element, attribute))
    .map((attribute) => [expandedName(attribute), attribute.value] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  const children: CanonicalNode[] = [];
  let text = '';
  const flushText = (): void => {
    if (text.trim() !== '') children.push(['text', text]);
    text = '';
  };

  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 || child.nodeType === 4) {
      text += child.nodeValue ?? '';
      continue;
    }
    flushText();
    if (child.nodeType === 1) {
      const canonicalChild = canonicalizeElement(child as XmlElement, [...ancestors, element]);
      if (canonicalChild) children.push(canonicalChild);
    } else if (child.nodeType === 7) {
      children.push(['processing-instruction', child.nodeName, child.nodeValue ?? '']);
    }
  }
  flushText();

  if (isEmptyStyleContainer(element, attributes, children)) return undefined;
  return ['element', expandedName(element), attributes, children];
}

function isIgnoredPresentationFormat(element: XmlElement, ancestors: XmlElement[]): boolean {
  if (!isUnnamespacedNamed(element, 'format')) return false;
  if (
    !ancestors.some(
      (ancestor) =>
        isUnnamespacedNamed(ancestor, 'style') || isUnnamespacedNamed(ancestor, 'zone-style'),
    )
  ) {
    return false;
  }
  const formatAttribute = element.getAttribute('attr');
  if (!formatAttribute || !PRESENTATION_FORMAT_ATTRIBUTES.has(formatAttribute)) return false;

  const attributeNames = Array.from(
    { length: element.attributes.length },
    (_, index) => element.attributes.item(index)?.name,
  ).filter((name): name is string => Boolean(name));
  return (
    attributeNames.length === 2 &&
    attributeNames.includes('attr') &&
    attributeNames.includes('value') &&
    hasNoMeaningfulChildren(element)
  );
}

function hasNoMeaningfulChildren(element: XmlElement): boolean {
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 || child.nodeType === 7) return false;
    if ((child.nodeType === 3 || child.nodeType === 4) && (child.nodeValue ?? '').trim() !== '') {
      return false;
    }
  }
  return true;
}

function isStyleOwnedElementAttribute(element: XmlElement, attribute: XmlAttr): boolean {
  if (!isUnnamespaced(element) || !isUnnamespaced(attribute)) return false;
  const owned = STYLE_OWNED_ELEMENT_ATTRIBUTES[element.localName ?? element.nodeName];
  return Boolean(owned?.has(attribute.localName ?? attribute.nodeName));
}

function isEmptyStyleContainer(
  element: XmlElement,
  attributes: ReadonlyArray<readonly [string, string]>,
  children: CanonicalNode[],
): boolean {
  if (!isUnnamespaced(element)) return false;
  const allowedAttributes = STYLE_CONTAINER_ATTRIBUTES[element.localName ?? element.nodeName];
  if (!allowedAttributes || children.length !== 0) return false;
  return attributes.every(([name]) => allowedAttributes.has(name));
}

function expandedName(node: XmlElement | XmlAttr): string {
  return node.namespaceURI ? `{${node.namespaceURI}}${node.localName}` : node.nodeName;
}

function isNamespaceDeclaration(attribute: XmlAttr): boolean {
  return attribute.name === 'xmlns' || attribute.prefix === 'xmlns';
}

function isUnnamespaced(node: XmlElement | XmlAttr): boolean {
  return !node.namespaceURI && !node.prefix;
}

function isUnnamespacedNamed(element: XmlElement | null, expectedName: string): boolean {
  return Boolean(element && element.nodeName === expectedName && isUnnamespaced(element));
}
