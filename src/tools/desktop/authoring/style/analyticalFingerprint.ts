import { createHash } from 'node:crypto';

import {
  Attr as XmlAttr,
  Document as XmlDocument,
  DOMParser,
  Element as XmlElement,
  Node as XmlNode,
} from '@xmldom/xmldom';

type CanonicalNode = [kind: string, ...parts: unknown[]];

export function analyticalFingerprint(xml: string): string {
  return fingerprint(xml);
}

export function eligibleStyleScopeFingerprint(
  xml: string,
  eligibleWorksheetNames: readonly string[],
): string {
  return fingerprint(
    xml,
    new Set(eligibleWorksheetNames.map((name) => name.trim().normalize('NFC'))),
  );
}

export function workbookStyleStateFingerprint(xml: string): string {
  const document = parseWorkbook(xml);
  const root = document.documentElement;
  if (!root) throw new Error('Cannot fingerprint an empty workbook XML document');
  const worksheets = directChildren(root, 'worksheets').flatMap((collection) =>
    directChildren(collection, 'worksheet'),
  );
  const presentation = worksheets.map((worksheet) => [
    unnamespacedAttributeValue(worksheet, 'name')?.trim().normalize('NFC') ?? null,
    supportedPresentationValues(worksheet),
  ]);
  return createHash('sha256').update(JSON.stringify(presentation)).digest('hex');
}

function fingerprint(xml: string, eligibleWorksheetNames?: ReadonlySet<string>): string {
  const document = parseWorkbook(xml);
  const root = document.documentElement;
  if (!root) throw new Error('Cannot fingerprint an empty workbook XML document');
  const canonical = canonicalizeElement(root, [], eligibleWorksheetNames);
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
  eligibleWorksheetNames?: ReadonlySet<string>,
): CanonicalNode | undefined {
  const attributes = Array.from({ length: element.attributes.length }, (_, index) =>
    element.attributes.item(index),
  )
    .filter((attribute): attribute is XmlAttr => Boolean(attribute))
    .filter((attribute) => !isNamespaceDeclaration(attribute))
    .filter(
      (attribute) =>
        !isSupportedPresentationAttribute(element, attribute, ancestors, eligibleWorksheetNames),
    )
    .map((attribute) => [expandedName(attribute), attribute.value] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  const children: CanonicalNode[] = [];
  let text = '';
  const ignoreText = isSupportedPaletteColorLeaf(element, ancestors, eligibleWorksheetNames);
  const flushText = (): void => {
    if (!ignoreText && text.trim() !== '') children.push(['text', text]);
    text = '';
  };

  for (let child: XmlNode | null = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 || child.nodeType === 4) {
      text += child.nodeValue ?? '';
      continue;
    }
    flushText();
    if (child.nodeType === 1) {
      const canonicalChild = canonicalizeElement(
        child as XmlElement,
        [...ancestors, element],
        eligibleWorksheetNames,
      );
      if (canonicalChild) children.push(canonicalChild);
    } else if (child.nodeType === 7) {
      children.push(['processing-instruction', child.nodeName, child.nodeValue ?? '']);
    }
  }
  flushText();

  return ['element', expandedName(element), attributes, children];
}

function isSupportedPresentationAttribute(
  element: XmlElement,
  attribute: XmlAttr,
  ancestors: XmlElement[],
  eligibleWorksheetNames?: ReadonlySet<string>,
): boolean {
  if (!isUnnamespaced(element) || !isUnnamespaced(attribute)) return false;
  if (!presentationCanChange(ancestors, eligibleWorksheetNames)) return false;

  if (
    isUnnamespacedNamed(element, 'run') &&
    (attribute.nodeName === 'fontname' || attribute.nodeName === 'fontcolor') &&
    hasDirectPath(ancestors, ['worksheet', 'layout-options', 'title', 'formatted-text'])
  ) {
    return true;
  }

  if (
    isUnnamespacedNamed(element, 'format') &&
    attribute.nodeName === 'value' &&
    hasDirectPath(ancestors, ['worksheet', 'table', 'style', 'style-rule'])
  ) {
    const selector = unnamespacedAttributeValue(element, 'attr');
    if (selector === 'font-family' || selector === 'color') return true;
    const styleRule = ancestors.at(-1);
    return (
      selector === 'background-color' &&
      isUnnamespacedNamed(styleRule ?? null, 'style-rule') &&
      unnamespacedAttributeValue(styleRule, 'element') === 'table'
    );
  }

  if (
    isUnnamespacedNamed(element, 'map') &&
    attribute.nodeName === 'to' &&
    hasDirectPath(ancestors, ['worksheet', 'table', 'style', 'style-rule', 'encoding'])
  ) {
    const styleRule = ancestors.at(-2);
    const encoding = ancestors.at(-1);
    return (
      unnamespacedAttributeValue(styleRule, 'element') === 'mark' &&
      unnamespacedAttributeValue(encoding, 'attr') === 'color' &&
      unnamespacedAttributeValue(encoding, 'type') === 'palette'
    );
  }

  return false;
}

function isSupportedPaletteColorLeaf(
  element: XmlElement,
  ancestors: XmlElement[],
  eligibleWorksheetNames?: ReadonlySet<string>,
): boolean {
  if (!presentationCanChange(ancestors, eligibleWorksheetNames)) return false;
  if (
    !isUnnamespacedNamed(element, 'color') ||
    element.attributes.length !== 0 ||
    !hasDirectPath(ancestors, [
      'worksheet',
      'table',
      'style',
      'style-rule',
      'encoding',
      'color-palette',
    ])
  ) {
    return false;
  }
  const styleRule = ancestors.at(-3);
  const encoding = ancestors.at(-2);
  const palette = ancestors.at(-1);
  const paletteType = unnamespacedAttributeValue(palette, 'type');
  if (
    unnamespacedAttributeValue(styleRule, 'element') !== 'mark' ||
    unnamespacedAttributeValue(encoding, 'attr') !== 'color' ||
    unnamespacedAttributeValue(encoding, 'type') !== 'custom-interpolated' ||
    unnamespacedAttributeValue(palette, 'custom') !== 'true' ||
    (paletteType !== 'ordered-sequential' && paletteType !== 'ordered-diverging')
  ) {
    return false;
  }
  return hasOnlyText(element);
}

function presentationCanChange(
  ancestors: XmlElement[],
  eligibleWorksheetNames?: ReadonlySet<string>,
): boolean {
  if (!eligibleWorksheetNames) return true;
  const worksheet = ancestors.find((ancestor) => isUnnamespacedNamed(ancestor, 'worksheet'));
  const name = unnamespacedAttributeValue(worksheet, 'name');
  return name !== undefined && eligibleWorksheetNames.has(name.trim().normalize('NFC'));
}

function supportedPresentationValues(worksheet: XmlElement): unknown[] {
  const values: unknown[] = [];
  const visit = (parent: XmlElement, ancestors: XmlElement[], parentPath: string): void => {
    const siblingCounts = new Map<string, number>();
    for (const child of directChildren(parent)) {
      const name = expandedName(child);
      const index = siblingCounts.get(name) ?? 0;
      siblingCounts.set(name, index + 1);
      const path = `${parentPath}/${name}[${index}]`;
      const attributes = Array.from({ length: child.attributes.length }, (_, attributeIndex) =>
        child.attributes.item(attributeIndex),
      )
        .filter((attribute): attribute is XmlAttr => Boolean(attribute))
        .filter((attribute) => isSupportedPresentationAttribute(child, attribute, ancestors))
        .sort((left, right) => {
          const leftName = expandedName(left);
          const rightName = expandedName(right);
          return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
        });
      for (const attribute of attributes) {
        values.push([path, `@${expandedName(attribute)}`, attribute.value]);
      }
      if (isSupportedPaletteColorLeaf(child, ancestors)) {
        values.push([path, '#text', childText(child)]);
      }
      visit(child, [...ancestors, child], path);
    }
  };
  visit(worksheet, [worksheet], 'worksheet');
  return values;
}

function directChildren(parent: XmlNode, name?: string): XmlElement[] {
  const children: XmlElement[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue;
    const element = child as XmlElement;
    if (name === undefined || isUnnamespacedNamed(element, name)) children.push(element);
  }
  return children;
}

function childText(element: XmlElement): string {
  let text = '';
  for (let child: XmlNode | null = element.firstChild; child; child = child.nextSibling) {
    text += child.nodeValue ?? '';
  }
  return text;
}

function hasOnlyText(element: XmlElement): boolean {
  if (!element.firstChild) return false;
  for (let child: XmlNode | null = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 3 && child.nodeType !== 4) return false;
  }
  return true;
}

function hasDirectPath(ancestors: XmlElement[], path: string[]): boolean {
  if (ancestors.length < path.length) return false;
  const offset = ancestors.length - path.length;
  return path.every((name, index) => isUnnamespacedNamed(ancestors[offset + index], name));
}

function unnamespacedAttributeValue(
  element: XmlElement | undefined,
  name: string,
): string | undefined {
  const attribute = element?.getAttributeNode(name);
  return attribute && isUnnamespaced(attribute) ? attribute.value : undefined;
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
