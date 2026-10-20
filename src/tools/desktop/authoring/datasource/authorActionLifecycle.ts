import { DOMParser, Element } from '@xmldom/xmldom';
import { Ok, Result } from 'ts-results-es';

import {
  parseActions,
  parseXmlBoolean,
  readWorkbookActions,
  WorkbookAction,
} from '../../../../desktop/metadata/workbookActions.js';
import { ArgsValidationError, XmlModificationError } from '../../../../errors/mcpToolError.js';

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

export function appendedActionsError(
  xml: string,
  baselineActions: WorkbookAction[],
): XmlModificationError | undefined {
  const readback = readWorkbookActions(xml);
  if (readback.isErr() || readback.value.length <= baselineActions.length) return undefined;
  const readbackNames = new Set(readback.value.map((action) => action.name));
  if (!baselineActions.every((action) => readbackNames.has(action.name))) return undefined;
  return new XmlModificationError(
    'This Desktop build adds actions instead of replacing them. Copies were added to the workbook. Run undo-workbook in the same session to remove the copies, then use a Desktop build that supports replacing workbook actions before retrying.',
  );
}

export function editRecoveryError(
  xml: string,
  original: WorkbookAction,
): XmlModificationError | undefined {
  const readback = readWorkbookActions(xml);
  const action = readback.isOk()
    ? readback.value.find((candidate) => candidate.name === original.name)
    : undefined;
  if (readback.isOk() && action?.xml === original.xml) return undefined;
  const reason = readback.isErr()
    ? 'the original action could not be verified'
    : action === undefined
      ? 'the original action is no longer present'
      : 'the original action definition changed';
  return new XmlModificationError(
    `edit failed verification for "${original.name}": ${reason}. Run undo-workbook in the same session to restore the previous workbook before retrying.`,
  );
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
  if (
    parseXmlBoolean(attr(actual, 'enabled'), true) !==
    parseXmlBoolean(attr(expected, 'enabled'), true)
  )
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
    parseXmlBoolean(attr(activation, 'auto-clear'), false) !==
    parseXmlBoolean(attr(expectedActivation, 'auto-clear'), false)
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
      parseXmlBoolean(attr(child(actual, 'single-select'), 'value'), false) ===
        parseXmlBoolean(attr(child(expected, 'single-select'), 'value'), false)
    );
  }
  const link = child(actual, 'link');
  const expectedLink = child(expected, 'link');
  if (expectedLink) {
    if (!link) return false;
    const text = (element: Element, tag: string): string =>
      child(element, tag)?.textContent?.trim() ?? '';
    return (
      parseXmlBoolean(attr(link, 'url-escape'), false) ===
        parseXmlBoolean(attr(expectedLink, 'url-escape'), false) &&
      (text(link, 'url-action-type') || 'default-zone-or-browser') ===
        (text(expectedLink, 'url-action-type') || 'default-zone-or-browser') &&
      text(link, 'url-action-target') === text(expectedLink, 'url-action-target')
    );
  }
  return true;
}
