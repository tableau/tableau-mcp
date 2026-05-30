import { DOMParser } from '@xmldom/xmldom';

import { DOM, DOMElement, DOMElementAttributes } from './dom.js';

export class XMLParser {
  private xmlString: string;

  constructor(xmlString: string) {
    this.xmlString = xmlString;
  }

  parse(): DOM {
    // Parse XML string into DOM
    let documentElement: Element | null = null;

    try {
      // Try using @xmldom/xmldom first (Node.js)
      let hadError = false;
      const parser = new DOMParser({
        errorHandler: (level, msg) => {
          if (level === 'error') {
            hadError = true;
          } else if (level === 'fatalError') {
            hadError = true;
            throw new Error(`Invalid XML: ${msg}`);
          }
        },
      });

      const xmlDoc = parser.parseFromString(this.xmlString, 'text/xml');

      // Check for parsing errors
      const parserError = xmlDoc.getElementsByTagName('parsererror');
      if (parserError && parserError.length > 0) {
        const errorText = parserError[0].textContent || 'Unknown parsing error';
        throw new Error(`Invalid XML: ${errorText}`);
      }

      // Check if document has a valid root element
      if (!xmlDoc.documentElement && hadError) {
        throw new Error('Invalid XML: parsing failed');
      }

      if (!isElement(xmlDoc.documentElement)) {
        throw new Error('Invalid XML: document element is not an element');
      }

      documentElement = xmlDoc.documentElement;
    } catch (e: any) {
      // Fallback: try using browser DOMParser if available
      if (typeof window !== 'undefined' && window.DOMParser) {
        try {
          const domParser = new window.DOMParser();
          const xmlDoc = domParser.parseFromString(this.xmlString, 'text/xml');
          const parserError = xmlDoc.querySelector('parsererror');
          if (parserError) {
            throw new Error(`Invalid XML: ${parserError.textContent}`);
          }
          documentElement = xmlDoc.documentElement;
        } catch (e2: any) {
          throw new Error(`Invalid XML: ${e2.message || e2}`);
        }
      } else {
        throw new Error(`Invalid XML: ${e.message || e}`);
      }
    }

    if (!documentElement) {
      throw new Error('Invalid XML: no root element found');
    }

    const dom = new DOM();
    const domElement = this.elementToDOMElement(documentElement);
    dom.getRoot().addChild(domElement);

    return dom;
  }

  private elementToDOMElement(element: Element): DOMElement {
    // Convert an XML element to a DOMElement
    // Get attributes
    const attributes: DOMElementAttributes = {};
    if (element.attributes) {
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        attributes[attr.name] = attr.value;
      }
    }

    // Create DOM element (text will be set from child nodes)
    const domElement = new DOMElement(element.tagName, attributes);

    // Process children and collect text
    const childNodes =
      [...element.childNodes].filter((node): node is Element => node instanceof Element) || [];
    const textParts: string[] = [];

    for (let i = 0; i < childNodes.length; i++) {
      const child = childNodes[i];
      const nodeType = child.nodeType;
      // Node.ELEMENT_NODE = 1, Node.TEXT_NODE = 3, Node.CDATA_SECTION_NODE = 4
      if (nodeType === 1) {
        // Element node - add as child
        const childElement = child;
        const childDOM = this.elementToDOMElement(childElement);
        domElement.addChild(childDOM);
      } else if (nodeType === 4) {
        // CDATA section - preserve content verbatim (e.g. SQL, formulas)
        const cdataContent = child.nodeValue || child.textContent || '';
        if (cdataContent) {
          textParts.push(cdataContent);
          domElement.encoded = true; // Flag for CDATA round-trip
        }
      } else if (nodeType === 3) {
        // Text node - collect text content
        const textNode = child;
        const raw = textNode.textContent || textNode.nodeValue || '';
        // Preserve raw content; trimming happens below based on context
        if (raw) {
          textParts.push(raw);
        }
      }
    }

    // Set text content if we collected any
    if (textParts.length > 0) {
      if (domElement.children.length === 0) {
        // Leaf node: preserve text verbatim (significant whitespace in <run>, formulas, etc.)
        domElement.text = textParts.join('');
      } else {
        // Has child elements: text is likely just indentation whitespace — only keep if non-trivial
        const joined = textParts.join('').trim();
        if (joined) {
          domElement.text = joined;
        }
      }
    }

    return domElement;
  }
}

function isElement(node: unknown): node is Element {
  return node instanceof Element;
}
