/**
 * DOM to JSON formatter matching JSONDOMFormatter logic.
 */

import { DOM, DOMElement, DOMElementAttributes } from './dom.js';

interface JSONNode {
  type?: string;
  attrs?: DOMElementAttributes;
  content?: string;
  children?: JSONNode[];
}

export class JSONFormatter {
  private jsonDoc: { root: JSONNode };
  private curNodeStack: (JSONNode | JSONNode[])[];

  constructor() {
    // Match JSONDOMFormatter constructor: create root object
    this.jsonDoc = { root: {} };
    this.curNodeStack = [this.jsonDoc.root];
  }

  formatDOM(dom: DOM): string {
    const root = dom.getDocumentRoot();
    if (root !== null) {
      this.outputDOMElement(root);
    }

    // Match GetStringOutput: return just the root object content
    // But we need to wrap it in {"children": [...]} format
    const rootObj = this.jsonDoc.root;
    if (!rootObj.children) {
      rootObj.children = [];
    }

    // Return the root object (which contains children), not the full doc
    return JSON.stringify(rootObj);
  }

  private outputDOMElement(element: DOMElement): void {
    // Output a DOM element to JSON (matching OutputDOMElement)
    this.outputAnObject(element.name, element.attributes, element.text, element.children);
    // Note: OutputCloseTag is handled in outputAnObject
  }

  private outputAnObject(
    tag: string,
    attributes: DOMElementAttributes,
    content: string,
    children: DOMElement[],
  ): void {
    /**
     * Output an object to JSON (matching OutputAnObject logic).
     */
    // Ensure current node has a children array
    let curNode = this.curNodeStack[this.curNodeStack.length - 1];
    if (!Array.isArray(curNode)) {
      const node = curNode;
      if (!node.children) {
        node.children = [];
      }
      this.curNodeStack.push(node.children);
      curNode = this.curNodeStack[this.curNodeStack.length - 1];
    }

    // Create the new object
    const tagObj: JSONNode = { type: tag };

    // Add attributes if present
    if (Object.keys(attributes).length > 0) {
      tagObj.attrs = attributes;
    }

    // Add content if present
    if (content) {
      tagObj.content = content;
    }

    // Add to parent array
    (curNode as JSONNode[]).push(tagObj);
    this.curNodeStack.push(tagObj);

    // Handle children
    if (children.length > 0) {
      tagObj.children = [];
      this.curNodeStack.push(tagObj.children);
      for (const child of children) {
        this.outputDOMElement(child);
      }
      // Pop children array
      this.curNodeStack.pop();
    }

    // Pop the tag object (matching OutputCloseTag)
    this.curNodeStack.pop();
  }
}
