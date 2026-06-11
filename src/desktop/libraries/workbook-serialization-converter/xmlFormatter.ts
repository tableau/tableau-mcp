/**
 * DOM to XML formatter.
 */

import { DOM, DOMElement } from './dom.js';

export class XMLFormatter {
  formatDOM(dom: DOM, header: boolean = true): string {
    const root = dom.getDocumentRoot();
    if (root === null) {
      return header ? "<?xml version='1.0' encoding='utf-8' ?>\n" : '';
    }

    const result: string[] = [];
    if (header) {
      result.push("<?xml version='1.0' encoding='utf-8' ?>");
      result.push('');
    }

    this.domElementToXML(root, result, 0);
    return result.join('\n');
  }

  private domElementToXML(element: DOMElement, result: string[], indent: number): void {
    const indentStr = '  '.repeat(indent);
    let line = `${indentStr}<${element.name}`;

    // Add attributes with single quotes (matching Tableau format)
    const sortedKeys = Object.keys(element.attributes).sort();
    for (const key of sortedKeys) {
      const value = element.attributes[key];
      // Escape XML entities in attribute values
      const escapedValue = this.escapeXMLAttribute(value);
      line += ` ${key}='${escapedValue}'`;
    }

    // Handle content and children
    if (element.children.length === 0 && !element.text) {
      // Empty element
      line += ' />';
      result.push(line);
    } else if (element.text && element.children.length === 0) {
      // Text content only — use CDATA if flagged (preserves SQL, formulas etc.)
      if (element.encoded) {
        const safeText = element.text.replaceAll(']]>', ']]]]><![CDATA[>');
        line += `><![CDATA[${safeText}]]></${element.name}>`;
      } else {
        const escapedText = this.escapeXMLContent(element.text);
        line += `>${escapedText}</${element.name}>`;
      }
      result.push(line);
    } else {
      // Has children
      line += '>';
      result.push(line);
      if (element.text) {
        // Text content before children
        const escapedText = this.escapeXMLContent(element.text);
        result.push(`${indentStr}  ${escapedText}`);
      }
      // Add children
      for (const child of element.children) {
        this.domElementToXML(child, result, indent + 1);
      }
      result.push(`${indentStr}</${element.name}>`);
    }
  }

  private escapeXMLAttribute(text: string): string {
    // Escape XML attribute value characters (using single quotes for delimiter)
    // Escape in order: & first, then others
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&apos;');
  }

  private escapeXMLContent(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
