import { DOMParser } from '@xmldom/xmldom';

import { parseXML, serializeXML } from '../metadata/parser.js';
import { stripCarriedActions, xmlStructurallyEqual } from './carriedActions.js';

const PARAM_ACTION =
  "<edit-parameter-action caption='Pick' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='A' /><params><param name='target-parameter' value='[Parameters].[P &amp; Q]' /></params></edit-parameter-action>";
const URL_ACTION =
  "<action caption='Open' name='[Action2]'><activation type='on-select' /><source type='sheet' worksheet='A' /><link caption='' expression='https://example.com/' /></action>";
const NEW_ACTION =
  "<action caption='New' name='[Action3]'><activation type='on-select' /><source type='sheet' worksheet='A' /><link caption='' expression='https://example.com/new' /></action>";

const wb = (actions: string): string =>
  `<?xml version='1.0' encoding='utf-8'?>\n<workbook version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>\n  <datasources><datasource name='ds' /></datasources>${actions}\n  <worksheets><worksheet name='A' /></worksheets>\n</workbook>`;
const block = (inner: string): string => `\n  <actions>${inner}</actions>`;

function names(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return Array.from(doc.getElementsByTagName('actions')[0]?.childNodes ?? [])
    .filter((n) => n.nodeType === 1)
    .map((n) => (n as unknown as Element).getAttribute('name') ?? '');
}

describe('xmlStructurallyEqual', () => {
  it('ignores attribute order, quote style and whitespace-only text', () => {
    expect(
      xmlStructurallyEqual(
        '<a x=\'1\' y="2"><b/>\n  <c>t</c></a>',
        '<a y=\'2\' x="1">\n<b></b><c>t</c>\n</a>',
      ),
    ).toBe(true);
  });

  it('compares entity-decoded attribute values', () => {
    expect(xmlStructurallyEqual("<a v='x &amp; y'/>", '<a v="x &#38; y"/>')).toBe(true);
    expect(xmlStructurallyEqual("<a v='x &amp; y'/>", '<a v="x y"/>')).toBe(false);
  });

  it('is false for different attributes, child order, text, comments, or malformed input', () => {
    expect(xmlStructurallyEqual("<a x='1'/>", "<a x='1' y='2'/>")).toBe(false);
    expect(xmlStructurallyEqual('<a><b/><c/></a>', '<a><c/><b/></a>')).toBe(false);
    expect(xmlStructurallyEqual('<a>one</a>', '<a>two</a>')).toBe(false);
    expect(xmlStructurallyEqual('<a><!--x--></a>', '<a><!--y--></a>')).toBe(false);
    expect(xmlStructurallyEqual('<a><!--x--></a>', '<a><!--x--></a>')).toBe(true);
    expect(xmlStructurallyEqual('<a>', '<a/>')).toBe(false);
  });
});

describe('stripCarriedActions', () => {
  it('drops the whole block, leaving the rest byte-identical, when every action is carried', () => {
    const live = wb(block(PARAM_ACTION + URL_ACTION));
    const payload = wb(block(PARAM_ACTION + URL_ACTION));
    const result = stripCarriedActions(payload, live);
    expect(result?.carriedNames).toEqual(['[Action1]', '[Action2]']);
    expect(result?.xml).toBe(payload.replace(/<actions>[\s\S]*<\/actions>/, ''));
  });

  it('keeps the new action and removes the carried ones', () => {
    const result = stripCarriedActions(
      wb(block(PARAM_ACTION + URL_ACTION + NEW_ACTION)),
      wb(block(PARAM_ACTION + URL_ACTION)),
    );
    expect(result?.carriedNames).toEqual(['[Action1]', '[Action2]']);
    expect(names(result!.xml)).toEqual(['[Action3]']);
    expect(result!.xml).toContain("<worksheets><worksheet name='A' /></worksheets>");
  });

  it('keeps nested datasource-dependencies alongside the remaining action', () => {
    const deps =
      "<datasource-dependencies datasource='ds'><column name='[x]' /></datasource-dependencies>";
    const result = stripCarriedActions(
      wb(block(URL_ACTION + deps + PARAM_ACTION)),
      wb(block(URL_ACTION)),
    );
    expect(result?.xml).toContain('datasource-dependencies');
    expect(names(result!.xml)).toContain('[Action1]');
    expect(names(result!.xml)).not.toContain('[Action2]');
  });

  it('does not strip an edit (same name, different structure)', () => {
    const edited = URL_ACTION.replace('example.com/', 'example.org/');
    expect(stripCarriedActions(wb(block(edited)), wb(block(URL_ACTION)))).toBeUndefined();
  });

  it('leaves deletes alone: a live action missing from the payload is not carried', () => {
    const result = stripCarriedActions(
      wb(block(PARAM_ACTION)),
      wb(block(PARAM_ACTION + URL_ACTION)),
    );
    expect(result?.carriedNames).toEqual(['[Action1]']);
    expect(result?.xml).not.toContain('<actions');
  });

  it('returns undefined when live has no actions, nothing is carried, or documents do not parse', () => {
    expect(stripCarriedActions(wb(block(NEW_ACTION)), wb(''))).toBeUndefined();
    expect(stripCarriedActions(wb(block(NEW_ACTION)), wb(block(URL_ACTION)))).toBeUndefined();
    expect(stripCarriedActions(wb(block(URL_ACTION)), '<workbook>')).toBeUndefined();
    expect(stripCarriedActions('<nope', wb(block(URL_ACTION)))).toBeUndefined();
  });

  it('returns undefined for duplicate-name or unnamed live actions', () => {
    expect(
      stripCarriedActions(wb(block(URL_ACTION)), wb(block(URL_ACTION + URL_ACTION))),
    ).toBeUndefined();
    expect(
      stripCarriedActions(
        wb(block(URL_ACTION)),
        wb(block(URL_ACTION.replace(" name='[Action2]'", ''))),
      ),
    ).toBeUndefined();
  });

  it('counts a Desktop-shaped action as carried after a fast-xml-parser round trip', () => {
    // Real Desktop output: single quotes, tab indentation; the repo's serializer emits double quotes.
    const live = wb(block(`\n\t\t${PARAM_ACTION}\n\t`));
    const reserialized = serializeXML(parseXML(live));
    expect(reserialized).toContain('name="[Action1]"');
    const result = stripCarriedActions(reserialized, live);
    expect(result?.carriedNames).toEqual(['[Action1]']);
  });

  it('does not re-declare a prefix the payload root already declares', () => {
    const userAction = URL_ACTION.replace("caption='Open'", "caption='Open' user:ui-builder='x'");
    const result = stripCarriedActions(
      wb(block(URL_ACTION + userAction.replace('[Action2]', '[Action9]'))),
      wb(block(URL_ACTION)),
    );
    expect(result?.xml).toContain('user:ui-builder');
    expect(result?.xml.match(/xmlns:user=/g)?.length).toBe(1);
  });
});
