import { Document, DOMParser, Element, Node, XMLSerializer } from '@xmldom/xmldom';
import { Ok, Result } from 'ts-results-es';

import { ArgsValidationError, XmlModificationError } from '../../../../errors/mcpToolError.js';

const actionTags = new Set(['action', 'nav-action', 'edit-group-action', 'edit-parameter-action']);

export type WorkbookAction = { name: string; caption: string; enabled: boolean; xml: string };

function parseActions(xml: string): {
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
    (node) => node.nodeType === 1 && actionTags.has(node.nodeName),
  );
  const serializer = new XMLSerializer();
  const actions = elements.map((node) => {
    const element = node as ReturnType<typeof document.createElement>;
    return {
      name: element.getAttribute('name') ?? '',
      caption: element.getAttribute('caption') ?? '',
      enabled: element.getAttribute('enabled') !== 'false',
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

export function removeWorkbookAction(
  xml: string,
  actionName: string,
): Result<{ action: WorkbookAction; xml: string }, ArgsValidationError | XmlModificationError> {
  try {
    const { document, elements, actions, serializer } = parseActions(xml);
    const index = actions.findIndex((action) => action.name === actionName);
    if (index === -1) {
      return new ArgsValidationError(
        `actionName "${actionName}" was not found. Available actions: ${actions.map((action) => `${action.name} (${action.caption})`).join(', ') || 'none'}`,
      ).toErr();
    }
    elements[index].parentNode!.removeChild(elements[index]);
    return new Ok({ action: actions[index], xml: serializer.serializeToString(document) });
  } catch {
    return new XmlModificationError(
      'cannot edit actions: malformed workbook or action identities',
    ).toErr();
  }
}

export function actionNamesMatch(actions: WorkbookAction[], names: string[]): boolean {
  return actions.length === names.length && actions.every((action) => names.includes(action.name));
}

// Desktop adds defaults on save. Check the authored settings without requiring byte equality.
export function editedActionSettingsMatch(actualXml: string, expectedXml: string): boolean {
  const parser = new DOMParser();
  const actual = parser.parseFromString(actualXml, 'text/xml').documentElement;
  const expected = parser.parseFromString(expectedXml, 'text/xml').documentElement;
  if (!actual || !expected || actual.tagName !== expected.tagName) return false;
  const child = (element: Element, tag: string): Element | undefined =>
    Array.from(element.childNodes).find(
      (node): node is Element => node.nodeType === 1 && node.nodeName === tag,
    );
  const attr = (element: Element | undefined, name: string): string =>
    element?.getAttribute(name) ?? '';
  if ((attr(actual, 'enabled') === 'false') !== (attr(expected, 'enabled') === 'false'))
    return false;
  const source = child(actual, 'source');
  const expectedSource = child(expected, 'source');
  if (!source || !expectedSource) return false;
  if (
    ['type', 'worksheet', 'dashboard'].some(
      (name) => attr(source, name) !== attr(expectedSource, name),
    )
  )
    return false;
  const exclusions = (element: Element): string[] =>
    Array.from(element.getElementsByTagName('exclude-sheet'))
      .map((node) => attr(node, 'name'))
      .sort();
  if (JSON.stringify(exclusions(source)) !== JSON.stringify(exclusions(expectedSource)))
    return false;
  const activation = child(actual, 'activation');
  const expectedActivation = child(expected, 'activation');
  if (attr(activation, 'type') !== attr(expectedActivation, 'type')) return false;
  if (
    (attr(activation, 'auto-clear') === 'true') !==
    (attr(expectedActivation, 'auto-clear') === 'true')
  )
    return false;
  const param = (element: Element, name: string): string | null | undefined =>
    Array.from(element.getElementsByTagName('param'))
      .find((node) => attr(node, 'name') === name)
      ?.getAttribute('value');
  if (expected.tagName === 'edit-parameter-action') {
    const clear = child(actual, 'clear-option');
    const expectedClear = child(expected, 'clear-option');
    return (
      param(actual, 'source-field') === param(expected, 'source-field') &&
      (attr(expectedClear, 'type') !== 'assign-fixed-value' ||
        attr(clear, 'value') === attr(expectedClear, 'value'))
    );
  }
  if (expected.tagName === 'edit-group-action') {
    return (
      attr(child(actual, 'add-or-remove-marks'), 'value') ===
        attr(child(expected, 'add-or-remove-marks'), 'value') &&
      param(actual, 'selection-clear-set-option') ===
        param(expected, 'selection-clear-set-option') &&
      (attr(child(actual, 'single-select'), 'value') === 'true') ===
        (attr(child(expected, 'single-select'), 'value') === 'true')
    );
  }
  const link = child(actual, 'link');
  const expectedLink = child(expected, 'link');
  if (expectedLink) {
    if (!link) return false;
    const text = (element: Element, tag: string): string =>
      child(element, tag)?.textContent?.trim() ?? '';
    return (
      (attr(link, 'url-escape') === 'true') === (attr(expectedLink, 'url-escape') === 'true') &&
      (text(link, 'url-action-type') || 'default-zone-or-browser') ===
        (text(expectedLink, 'url-action-type') || 'default-zone-or-browser') &&
      text(link, 'url-action-target') === text(expectedLink, 'url-action-target')
    );
  }
  return true;
}
