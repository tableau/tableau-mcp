import {
  Attr as XmlAttr,
  Document as XmlDocument,
  DOMParser,
  Element as XmlElement,
  Node as XmlNode,
} from '@xmldom/xmldom';

export function readAppliedCustomThemeName(workbookXml: string): string | undefined {
  const root = parseWorkbook(workbookXml);
  const candidates = directUnnamespacedChildren(root, 'style-theme');
  if (candidates.length !== 1) return undefined;

  const candidate = candidates[0];
  const name = unnamespacedAttributeValue(candidate, 'name');
  const value = unnamespacedAttributeValue(candidate, 'value');
  return name === 'custom' && value?.trim() ? value : undefined;
}

function parseWorkbook(xml: string): XmlElement {
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
    throw new Error('Native custom-theme verification requires well-formed workbook XML');
  }
  if (malformed) {
    throw new Error('Native custom-theme verification requires well-formed workbook XML');
  }
  const root = document.documentElement;
  if (!isUnnamespacedNamed(root, 'workbook')) {
    throw new Error('Native custom-theme verification requires an unnamespaced <workbook> root');
  }
  return root;
}

function directUnnamespacedChildren(parent: XmlElement, name: string): XmlElement[] {
  const matches: XmlElement[] = [];
  for (let child: XmlNode | null = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && isUnnamespacedNamed(child as XmlElement, name)) {
      matches.push(child as XmlElement);
    }
  }
  return matches;
}

function unnamespacedAttributeValue(element: XmlElement, name: string): string | undefined {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute && isUnnamespaced(attribute) && attribute.nodeName === name) {
      return attribute.value;
    }
  }
  return undefined;
}

function isUnnamespacedNamed(element: XmlElement | null, name: string): element is XmlElement {
  return Boolean(
    element &&
    isUnnamespaced(element) &&
    !element.prefix &&
    element.nodeName === name &&
    (element.localName ?? element.nodeName) === name,
  );
}

function isUnnamespaced(node: XmlElement | XmlAttr): boolean {
  return !node.namespaceURI;
}
