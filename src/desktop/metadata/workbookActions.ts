import { Document, DOMParser, Node, XMLSerializer } from '@xmldom/xmldom';
import { Ok, Result } from 'ts-results-es';

import { XmlModificationError } from '../../errors/mcpToolError.js';

export const ACTION_TAGS = new Set([
  'action',
  'nav-action',
  'edit-group-action',
  'edit-parameter-action',
]);

export type WorkbookAction = { name: string; caption: string; enabled: boolean; xml: string };

export function parseXmlBoolean(value: string | null | undefined, defaultValue: boolean): boolean {
  switch (value?.trim()) {
    case 'true':
    case '1':
      return true;
    case 'false':
    case '0':
      return false;
    default:
      return defaultValue;
  }
}

// Throws on malformed XML, a non-workbook root, several <actions> blocks, or unnamed/duplicate actions.
export function parseActions(xml: string): {
  document: Document;
  elements: Node[];
  actions: WorkbookAction[];
  serializer: XMLSerializer;
} {
  let malformed = false;
  const document = new DOMParser({
    onError: (level) => {
      if (level === 'error' || level === 'fatalError') malformed = true;
    },
  }).parseFromString(xml, 'text/xml');
  if (malformed || document.documentElement?.tagName !== 'workbook') {
    throw new Error('invalid workbook document');
  }
  const blocks = Array.from(document.documentElement.childNodes).filter(
    (node) => node.nodeType === 1 && node.nodeName === 'actions',
  );
  if (blocks.length > 1) throw new Error('multiple workbook actions blocks');
  const elements = Array.from(blocks[0]?.childNodes ?? []).filter(
    (node) => node.nodeType === 1 && ACTION_TAGS.has(node.nodeName),
  );
  const serializer = new XMLSerializer();
  const actions = elements.map((node) => {
    const element = node as ReturnType<typeof document.createElement>;
    return {
      name: element.getAttribute('name') ?? '',
      caption: element.getAttribute('caption') ?? '',
      enabled: parseXmlBoolean(element.getAttribute('enabled'), true),
      xml: serializer.serializeToString(element),
    };
  });
  if (actions.some((action) => action.name.length === 0)) throw new Error('unnamed action');
  if (new Set(actions.map((action) => action.name)).size !== actions.length) {
    throw new Error('duplicate action names');
  }
  return { document, elements, actions, serializer };
}

export function readWorkbookActions(xml: string): Result<WorkbookAction[], XmlModificationError> {
  try {
    return new Ok(parseActions(xml).actions);
  } catch {
    return new XmlModificationError(
      'cannot inspect actions: malformed workbook or action identities',
    ).toErr();
  }
}
