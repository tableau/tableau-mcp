/**
 * DOM-like data structures for representing XML/JSON documents.
 */

export interface DOMElementAttributes {
  [key: string]: string;
}

export class DOMElement {
  public name: string;
  public attributes: DOMElementAttributes;
  public text: string;
  public encoded: boolean;
  public children: DOMElement[];

  constructor(
    name: string,
    attributes: DOMElementAttributes = {},
    text: string = '',
    encoded: boolean = false,
  ) {
    this.name = name;
    this.attributes = attributes;
    this.text = text;
    this.encoded = encoded;
    this.children = [];
  }

  addChild(child: DOMElement): DOMElement {
    this.children.push(child);
    return child;
  }

  hasChildren(): boolean {
    return this.children.length > 0;
  }

  hasText(): boolean {
    return this.text.length > 0;
  }
}

export class DOM {
  private root: DOMElement;

  constructor() {
    // Create a sentinel root element
    this.root = new DOMElement('');
  }

  getRoot(): DOMElement {
    return this.root;
  }

  getDocumentRoot(): DOMElement | null {
    // Get the actual document root (first child of sentinel root)
    if (this.root.hasChildren()) {
      return this.root.children[0];
    }
    return null;
  }
}
