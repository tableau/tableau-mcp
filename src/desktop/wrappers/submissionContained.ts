import { DOMParser, Element } from '@xmldom/xmldom';

function parse(xml: string): Element {
  return new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') throw new Error(message);
    },
  }).parseFromString(xml, 'text/xml').documentElement as Element;
}

function elementChildren(element: Element): Element[] {
  return Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1);
}

const STRICT_CHILD: Record<string, string> = {
  zones: 'zone',
  zone: 'zone',
  devicelayouts: 'devicelayout',
};

function elementMatches(submitted: Element, live: Element): boolean {
  if (submitted.nodeName !== live.nodeName) return false;
  for (const attribute of Array.from(submitted.attributes)) {
    if (live.getAttribute(attribute.name) !== attribute.value) return false;
  }
  const submittedChildren = elementChildren(submitted);
  const liveChildren = elementChildren(live);
  const strictTag = STRICT_CHILD[submitted.nodeName];
  if (
    strictTag !== undefined &&
    submittedChildren.filter((child) => child.nodeName === strictTag).length !==
      liveChildren.filter((child) => child.nodeName === strictTag).length
  ) {
    return false;
  }
  if (submittedChildren.length === 0) {
    return (submitted.textContent ?? '').trim() === (live.textContent ?? '').trim();
  }
  let cursor = 0;
  for (const child of submittedChildren) {
    while (cursor < liveChildren.length && !elementMatches(child, liveChildren[cursor])) cursor++;
    if (cursor === liveChildren.length) return false;
    cursor++;
  }
  return true;
}

/**
 * True when every submitted element and attribute is already present, in order, in the live
 * document (live may carry extra attributes and children Desktop added, but zone and devicelayout
 * collections and element text must match exactly). Unparseable input
 * counts as contained: this gate must never fail an apply it cannot judge.
 */
export function submissionContainedInLive(submittedXml: string, liveXml: string): boolean {
  try {
    return elementMatches(parse(submittedXml), parse(liveXml));
  } catch {
    return true;
  }
}
