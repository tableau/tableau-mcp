import { DOM, DOMElement, DOMElementAttributes } from './dom.js';

interface SAXInterface {
  startElement(name: string, attributes: DOMElementAttributes): void;
  setEncoded(): void;
  textContent(text: string): void;
  endElement(): void;
}

class SAXHandler implements SAXInterface {
  private dom: DOM;
  private stack: DOMElement[];

  constructor(dom: DOM) {
    this.dom = dom;
    this.stack = [dom.getRoot()];
  }

  startElement(name: string, attributes: DOMElementAttributes): void {
    const parent = this.stack[this.stack.length - 1];
    const element = new DOMElement(name, attributes);
    parent.addChild(element);
    this.stack.push(element);
  }

  setEncoded(): void {
    if (this.stack.length > 0) {
      this.stack[this.stack.length - 1].encoded = true;
    }
  }

  textContent(text: string): void {
    if (this.stack.length > 0) {
      this.stack[this.stack.length - 1].text = text;
    }
  }

  endElement(): void {
    if (this.stack.length > 1) {
      // Keep root on stack
      this.stack.pop();
    }
  }
}

export class JSONParser {
  private jsonString: string;
  private sax: SAXHandler | null = null;

  constructor(jsonString: string) {
    this.jsonString = jsonString;
  }

  parse(): DOM {
    let document: any;
    try {
      document = JSON.parse(this.jsonString);
    } catch (e) {
      throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Match JSONDocParser::ParseImpl logic
    // Expect structure: {"children": [...]}
    if (!document.children || !Array.isArray(document.children) || document.children.length === 0) {
      throw new Error("JSON must have a 'children' array at root level");
    }

    const dom = new DOM();
    this.sax = new SAXHandler(dom);

    // Parse the first child (matching ParseValue(m_document["children"][0]))
    this.parseValue(document.children[0]);

    return dom;
  }

  private parseValue(value: any): void {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      this.parseObject(value);
    } else if (Array.isArray(value)) {
      this.parseArray(value);
    } else {
      this.parsePrimitive(value);
    }
  }

  private parseObject(obj: any): void {
    // Extract type (tag name), attrs, content, children
    // Match JSONDocParser::ParseObject logic
    const tagName = obj.type || '';
    const attrs = obj.attrs || {};
    const content = obj.content;
    const encoded = !!obj.encoded;
    const children = obj.children;

    // Convert attrs dict values to strings (matching ValueToString logic)
    const attributes: DOMElementAttributes = {};
    for (const key in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, key)) {
        continue;
      }

      attributes[key] = this.valueToString(attrs[key]);
    }

    this.sax!.startElement(tagName, attributes);

    if (encoded) {
      this.sax!.setEncoded();
    }

    // Parse children if present
    if (children !== undefined) {
      this.parseArray(children);
    }

    // Add content if present (after children, matching C++ code)
    if (content !== undefined) {
      this.sax!.textContent(this.valueToString(content));
    }

    this.sax!.endElement();
  }

  private parseArray(array: any[]): void {
    for (const item of array) {
      this.parseValue(item);
    }
  }

  private parsePrimitive(value: any): void {
    const text = this.valueToString(value);
    if (text) {
      this.sax!.textContent(text);
    }
  }

  private valueToString(value: any): string {
    // Convert a JSON value to string (matching ValueToString helper)
    if (typeof value === 'string') {
      return value;
    } else if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    } else if (value === null || value === undefined) {
      return 'null';
    } else if (typeof value === 'number') {
      return String(value);
    } else {
      // For objects and arrays, serialize to JSON string
      return JSON.stringify(value);
    }
  }
}
