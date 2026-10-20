import { DOMParser, Element, Node } from '@xmldom/xmldom';

import { ACTION_TAGS, parseActions } from '../metadata/workbookActions.js';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;
const COMMENT_NODE = 8;

type Comparable = Element | { kind: 'text' | 'comment'; value: string };

function comparableChildren(element: Element): Comparable[] | undefined {
  const out: Comparable[] = [];
  for (const child of Array.from(element.childNodes) as Node[]) {
    if (child.nodeType === ELEMENT_NODE) {
      out.push(child as Element);
    } else if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_NODE) {
      const value = child.nodeValue ?? '';
      if (value.trim().length > 0) out.push({ kind: 'text', value });
    } else if (child.nodeType === COMMENT_NODE) {
      out.push({ kind: 'comment', value: child.nodeValue ?? '' });
    } else {
      return undefined;
    }
  }
  return out;
}

// Same tag, same attributes (order ignored, values entity-decoded), same children in order,
// same text; whitespace-only text ignored. Any doubt (unknown node type) means not equal.
export function elementsStructurallyEqual(a: Element, b: Element): boolean {
  if (a.tagName !== b.tagName) return false;
  if (a.attributes.length !== b.attributes.length) return false;
  for (let i = 0; i < a.attributes.length; i++) {
    const attr = a.attributes.item(i);
    if (attr === null) return false;
    if (!b.hasAttribute(attr.name) || b.getAttribute(attr.name) !== attr.value) return false;
  }
  const left = comparableChildren(a);
  const right = comparableChildren(b);
  if (left === undefined || right === undefined || left.length !== right.length) return false;
  return left.every((l, i) => {
    const r = right[i];
    const lIsElement = 'tagName' in l;
    const rIsElement = 'tagName' in r;
    if (lIsElement || rIsElement) {
      return lIsElement && rIsElement && elementsStructurallyEqual(l, r);
    }
    return l.kind === r.kind && l.value === r.value;
  });
}

export function xmlStructurallyEqual(a: string, b: string): boolean {
  try {
    const parse = (xml: string): Element | null => {
      let malformed = false;
      const doc = new DOMParser({
        onError: (level) => {
          if (level === 'error' || level === 'fatalError') malformed = true;
        },
      }).parseFromString(xml, 'text/xml');
      return malformed ? null : doc.documentElement;
    };
    const left = parse(a);
    const right = parse(b);
    return left !== null && right !== null && elementsStructurallyEqual(left, right);
  } catch {
    return false;
  }
}

export type StripCarriedActionsResult = { xml: string; carriedNames: string[] };

// The top-level <actions> byte range; undefined unless the document has exactly one block.
function actionsBlockRange(xml: string): { start: number; end: number } | undefined {
  const openings = [...xml.matchAll(/<actions\b[^>]*>/g)];
  if (openings.length !== 1) return undefined;
  const opening = openings[0];
  if (/\/\s*>$/.test(opening[0])) return undefined;
  const close = xml.indexOf('</actions>', opening.index + opening[0].length);
  if (close === -1) return undefined;
  return { start: opening.index, end: close + '</actions>'.length };
}

// Drops payload actions the live workbook already holds unchanged; undefined means POST as-is.
export function stripCarriedActions(
  payloadXml: string,
  liveXml: string,
): StripCarriedActionsResult | undefined {
  try {
    const live = parseActions(liveXml);
    if (live.actions.length === 0) return undefined;
    const liveByName = new Map(live.actions.map((action, i) => [action.name, live.elements[i]]));

    const payload = parseActions(payloadXml);
    const range = actionsBlockRange(payloadXml);
    if (range === undefined) return undefined;

    const carried: Node[] = [];
    const carriedNames: string[] = [];
    payload.actions.forEach((action, i) => {
      const liveElement = liveByName.get(action.name);
      if (
        liveElement !== undefined &&
        elementsStructurallyEqual(payload.elements[i] as Element, liveElement as Element)
      ) {
        carried.push(payload.elements[i]);
        carriedNames.push(action.name);
      }
    });
    if (carried.length === 0) return undefined;

    const block = payload.elements[0].parentNode!;
    for (const node of carried) block.removeChild(node);
    const remaining = Array.from(block.childNodes).some(
      (node) => node.nodeType === ELEMENT_NODE && ACTION_TAGS.has(node.nodeName),
    );
    let replacement = remaining ? payload.serializer.serializeToString(block) : '';
    // The serializer re-declares prefixes the payload root already declares.
    const root = payload.document.documentElement!;
    for (let i = 0; i < root.attributes.length; i++) {
      const attr = root.attributes.item(i);
      if (attr?.name.startsWith('xmlns:')) {
        replacement = replacement.split(` ${attr.name}="${attr.value}"`).join('');
      }
    }
    return {
      xml: payloadXml.slice(0, range.start) + replacement + payloadXml.slice(range.end),
      carriedNames,
    };
  } catch {
    return undefined;
  }
}
