import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getAuthorActionTool } from './authorAction.js';

const BASE_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource hasconnection='false' inline='true' name='Parameters'>",
  "<column caption='p.Period' datatype='string' name='[Parameter 1]' param-domain-type='list' role='measure' type='nominal' value='&quot;Month&quot;'><calculation class='tableau' formula='&quot;Month&quot;' /></column>",
  '</datasource>',
  "<datasource caption='Sample - Superstore' name='federated.1syzfv90anwuu119p4zra1ga299n'>",
  "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
  "<group caption='Category Set' name='[Category Set]' user:ui-builder='filter-group' />",
  "<group caption='Ad Hoc Group' name='[Ad Hoc Group]' />",
  '</datasource>',
  '</datasources>',
  "<worksheets><worksheet name='Profit' /></worksheets>",
  '</workbook>',
].join('');

describe('authorActionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the workbook-level <actions> block and splices an edit-parameter-action, verifying readback', async () => {
    const readbackXml = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Set Period' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='Profit' /><agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' /><params><param name='source-field' value='[Sample - Superstore].[:Measure Names]' /><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Sample - Superstore].[:Measure Names]',
        targetParameter: '[Parameters].[Parameter 1]',
        activation: 'on-select',
      },
      readbackXml,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.actionName).toBe('[Action1]');
    expect(parsed.caption).toBe('Set Period');
    expect(parsed.mode).toBe('parameter');
    expect(parsed.target).toBe('[Parameters].[Parameter 1]');
    expect(parsed.targetParameter).toBe('[Parameters].[Parameter 1]');

    const loaded = appliedDocumentXml(applyWorkbookDocument);
    // <actions> block created between </datasources> and <worksheets>.
    const dsClose = loaded.indexOf('</datasources>');
    const actionsAt = loaded.indexOf('<actions>');
    const wsAt = loaded.indexOf('<worksheets>');
    expect(dsClose).toBeLessThan(actionsAt);
    expect(actionsAt).toBeLessThan(wsAt);
    expect(loaded).toContain("<edit-parameter-action caption='Set Period' name='[Action1]'>");
    expect(loaded).toContain(
      "<param name='target-parameter' value='[Parameters].[Parameter 1]' />",
    );
  });

  it('appends into an existing <actions> block with a fresh action name', async () => {
    const withOne = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Existing' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='Profit' /><agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' /><params><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>",
    );
    const readbackXml = withOne.replace(
      '</actions>',
      "<edit-parameter-action caption='Second' name='[Action2]'><params><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action></actions>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Second',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetParameter: '[Parameters].[Parameter 1]',
      },
      initialXml: withOne,
      readbackXml,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).actionName).toBe('[Action2]');
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    // Only one <actions> block — appended, not duplicated.
    expect(loaded.match(/<actions>/g)?.length).toBe(1);
  });

  it('rejects a caption collision before loading metadata', async () => {
    const xml = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Dup' name='[Action1]'></edit-parameter-action>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Dup',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetParameter: '[Parameters].[Parameter 1]',
      },
      initialXml: xml,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('caption collision');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('detects caption collisions with edit-group-action elements', async () => {
    const xml = withActions(
      BASE_XML,
      "<edit-group-action caption='Dup' name='[Action1]'></edit-group-action>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Dup',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetSet: 'Category Set',
      },
      initialXml: xml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('caption collision');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('emits a byte-faithful set action with children in XSD order', async () => {
    const expectedAction =
      "<edit-group-action caption='Expand Category' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<single-select value='true' />" +
      "<add-or-remove-marks value='assign' />" +
      "<params><param name='selection-clear-set-option' value='do-nothing' />" +
      "<param name='target-group' value='[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]' /></params>" +
      '</edit-group-action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetSet: 'Category Set',
        singleSelect: true,
      },
      readbackXml: withActions(BASE_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.mode).toBe('set');
    expect(parsed.target).toBe('[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]');
    expect(parsed.targetSet).toBe('[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]');

    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    const activationAt = loaded.indexOf("<activation type='on-select' />");
    const sourceAt = loaded.indexOf("<source type='sheet' worksheet='Profit' />");
    const singleAt = loaded.indexOf("<single-select value='true' />");
    const membershipAt = loaded.indexOf("<add-or-remove-marks value='assign' />");
    const paramsAt = loaded.indexOf('<params>', membershipAt);
    expect(activationAt).toBeLessThan(sourceAt);
    expect(sourceAt).toBeLessThan(singleAt);
    expect(singleAt).toBeLessThan(membershipAt);
    expect(membershipAt).toBeLessThan(paramsAt);
  });

  it('accepts set-action readback when Desktop backfills single-select', async () => {
    const normalizedAction =
      "<edit-group-action caption='Expand Category' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<single-select value='false' />" +
      "<add-or-remove-marks value='assign' />" +
      "<params><param name='selection-clear-set-option' value='do-nothing' />" +
      "<param name='target-group' value='[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]' /></params>" +
      '</edit-group-action>';
    const { result } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        targetSet: 'Category Set',
      },
      readbackXml: withActions(BASE_XML, normalizedAction),
    });

    expect(result.isError).toBe(false);
  });

  it.each([
    ['assign', 'do-nothing'],
    ['add', 'show-all'],
    ['remove', 'exclude-all'],
  ] as const)(
    'emits set membership %s and clear selection %s in Tableau wire vocabulary',
    async (setMembership, clearSelection) => {
      const expectedAction =
        "<edit-group-action caption='Map Options' name='[Action1]'>" +
        "<activation type='on-select' />" +
        "<source type='sheet' worksheet='Profit' />" +
        `<add-or-remove-marks value='${setMembership}' />` +
        `<params><param name='selection-clear-set-option' value='${clearSelection}' />` +
        "<param name='target-group' value='[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]' /></params>" +
        '</edit-group-action>';
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          mode: 'set',
          caption: 'Map Options',
          sourceWorksheet: 'Profit',
          sourceField: '',
          targetSet: '[Category Set]',
          setMembership,
          clearSelection,
        },
        readbackXml: withActions(BASE_XML, expectedAction),
      });

      expect(result.isError).toBe(false);
      const loaded = appliedDocumentXml(applyWorkbookDocument);
      expect(loaded).toContain(`<add-or-remove-marks value='${setMembership}' />`);
      expect(loaded).toContain(
        `<param name='selection-clear-set-option' value='${clearSelection}' />`,
      );
    },
  );

  it('rejects a missing targetSet and names available sets', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        sourceField: '',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('targetSet');
    expect(result.content[0].text).toContain('Category Set');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('ignores non-set groups during target resolution and suggestions', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Group',
        sourceWorksheet: 'Profit',
        targetSet: 'Ad Hoc Group',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Category Set');
    expect(result.content[0].text).not.toContain('Ad Hoc Group (');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('does not parse datasource-dependencies as a datasource', async () => {
    const xml = BASE_XML.replace(
      '</datasource>',
      "<datasource-dependencies name='phantom'><group caption='Phantom Set' name='[Phantom Set]' user:ui-builder='filter-group' /></datasource-dependencies></datasource>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Phantom',
        sourceWorksheet: 'Profit',
        targetSet: 'Phantom Set',
        datasource: 'phantom',
      },
      initialXml: xml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain("datasource 'phantom' matched no datasource");
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('reports when a datasource filter matches no datasource', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        targetSet: 'Category Set',
        datasource: 'Missing Datasource',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      "datasource 'Missing Datasource' matched no datasource; sets found in:",
    );
    expect(result.content[0].text).toContain('Category Set');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects an unqualified targetParameter with recovery guidance', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetParameter: 'Parameter 1',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('[Parameters].[X]');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('requires sourceField in parameter mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        targetParameter: '[Parameters].[Parameter 1]',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('sourceField is required in parameter mode');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects mode-incompatible targets', async () => {
    const { result } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetSet: 'Category Set',
        targetParameter: '[Parameters].[Parameter 1]',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('targetParameter');
  });

  it('treats a blank targetParameter as absent in set mode', async () => {
    const action =
      "<edit-group-action caption='Expand Category' name='[Action1]'>" +
      "<activation type='on-select' /><source type='sheet' worksheet='Profit' />" +
      "<add-or-remove-marks value='assign' />" +
      "<params><param name='selection-clear-set-option' value='do-nothing' />" +
      "<param name='target-group' value='[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]' /></params>" +
      '</edit-group-action>';
    const { result } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        targetSet: 'Category Set',
        targetParameter: '   ',
      },
      readbackXml: withActions(BASE_XML, action),
    });

    expect(result.isError).toBe(false);
  });

  it('treats a blank targetSet as absent in parameter mode', async () => {
    const action =
      "<edit-parameter-action caption='Set Period' name='[Action1]'>" +
      "<activation type='on-select' /><source type='sheet' worksheet='Profit' />" +
      "<agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' />" +
      "<params><param name='source-field' value='[Profit]' />" +
      "<param name='target-parameter' value='[Parameters].[Parameter 1]' /></params>" +
      '</edit-parameter-action>';
    const { result } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
        targetParameter: '[Parameters].[Parameter 1]',
        targetSet: '\t ',
      },
      readbackXml: withActions(BASE_XML, action),
    });

    expect(result.isError).toBe(false);
  });

  it('fails set-action readback when the target-group param is absent', async () => {
    const incompleteAction =
      "<edit-group-action caption='Expand Category' name='[Action1]'>" +
      "<activation type='on-select' /><source type='sheet' worksheet='Profit' />" +
      "<add-or-remove-marks value='assign' />" +
      "<params><param name='selection-clear-set-option' value='do-nothing' /></params>" +
      '</edit-group-action>';
    const { result } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetSet: 'Category Set',
      },
      readbackXml: withActions(BASE_XML, incompleteAction),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('target-group');
  });

  it('fails parameter-action readback when the target-parameter param is absent', async () => {
    const incompleteAction =
      "<edit-parameter-action caption='Set Period' name='[Action1]'>" +
      "<activation type='on-select' /><source type='sheet' worksheet='Profit' />" +
      "<agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' />" +
      '<params></params></edit-parameter-action>';
    const { result } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetParameter: '[Parameters].[Parameter 1]',
      },
      readbackXml: withActions(BASE_XML, incompleteAction),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('target-parameter');
  });

  it('rejects empty required primitives', async () => {
    const { result } = await getToolResult({
      args: {
        caption: 'X',
        sourceWorksheet: '',
        sourceField: '',
        targetParameter: '[Parameters].[Parameter 1]',
      },
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('sourceWorksheet empty');
  });

  it("emits a byte-faithful worksheet-sourced url action with the URL in the link's expression attribute", async () => {
    const expectedAction =
      "<action caption='Open Product Details' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Product x Details' />" +
      "<link caption='' expression='https://www.google.com/search?q=&lt;[Product Name]&gt;' />" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Open Product Details',
        sourceWorksheet: 'Product x Details',
        url: 'https://www.google.com/search?q=<[Product Name]>',
      },
      readbackXml: withActions(BASE_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.mode).toBe('url');
    expect(parsed.actionName).toBe('[Action1]');
    expect(parsed.url).toBe('https://www.google.com/search?q=<[Product Name]>');
    expect(parsed.target).toBe('https://www.google.com/search?q=<[Product Name]>');

    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    // The URL must NOT appear as an expression attribute on <action> itself.
    expect(loaded).not.toMatch(/<action\b[^>]*\bexpression=/);
    // A URL action must never be emitted as a <command> child.
    expect(loaded).not.toContain('<command');
  });

  it('emits a dashboard-scoped url source with exclude-sheet opt-outs', async () => {
    const expectedAction =
      "<action caption='Open Sales Person' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' dashboard='Commission Model'>" +
      "<exclude-sheet name='Sales' /><exclude-sheet name='OTE' />" +
      '</source>' +
      "<link caption='' expression='https://www.google.com/search?q=&lt;[Sales Person]&gt;' />" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Open Sales Person',
        sourceWorksheet: '',
        sourceDashboard: 'Commission Model',
        excludeSheets: ['Sales', 'OTE'],
        url: 'https://www.google.com/search?q=<[Sales Person]>',
      },
      readbackXml: withActions(BASE_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
  });

  it('emits a combined worksheet+dashboard url source scoped within a dashboard', async () => {
    const expectedSource =
      "<source type='sheet' worksheet='QuotaAttainment' dashboard='Commission Model' />";
    const expectedAction =
      "<action caption='Open Person' name='[Action1]'>" +
      "<activation type='on-select' />" +
      expectedSource +
      "<link caption='' expression='https://example.com/p' />" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Open Person',
        sourceWorksheet: 'QuotaAttainment',
        sourceDashboard: 'Commission Model',
        url: 'https://example.com/p',
      },
      readbackXml: withActions(BASE_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedSource);
  });

  it('emits a url-action-type child for the browser target', async () => {
    const expectedAction =
      "<action caption='Open Browser' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<link caption='' expression='https://example.com/'>" +
      '<url-action-type>browser</url-action-type>' +
      '</link>' +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Open Browser',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/',
        urlTarget: 'browser',
      },
      readbackXml: withActions(BASE_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
  });

  it('emits url-action-type and url-action-target for a specific zone', async () => {
    const expectedAction =
      "<action caption='Open Zone' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<link caption='' expression='https://example.com/'>" +
      '<url-action-type>specific-zone</url-action-type>' +
      '<url-action-target>4</url-action-target>' +
      '</link>' +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Open Zone',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/',
        urlTarget: 'specific-zone',
        zoneId: '4',
      },
      readbackXml: withActions(BASE_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
  });

  it('emits url-escape when urlEncode is requested', async () => {
    const expectedLink =
      "<link caption='' expression='https://example.com/?q=&lt;[Sales Person]&gt;' url-escape='true' />";
    const expectedAction =
      "<action caption='Encoded' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      expectedLink +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Encoded',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/?q=<[Sales Person]>',
        urlEncode: true,
      },
      readbackXml: withActions(BASE_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedLink);
  });

  it('honors a non-default activation for url actions', async () => {
    const expectedAction =
      "<action caption='On Menu' name='[Action1]'>" +
      "<activation type='on-menu' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<link caption='' expression='https://example.com/' />" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'On Menu',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/',
        activation: 'on-menu',
      },
      readbackXml: withActions(BASE_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain("<activation type='on-menu' />");
  });

  it('fails url readback when the action landed as a <command> instead of a <link>', async () => {
    // The core failure mode: an action that persisted as a <command>, not a <link>, so
    // Tableau does not treat it as a URL action.
    const commandAction =
      "<action caption='Open Product Details' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:url'><param value='https://www.google.com/' /></command>" +
      '</action>';
    const { result } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Open Product Details',
        sourceWorksheet: 'Profit',
        url: 'https://www.google.com/',
      },
      readbackXml: withActions(BASE_XML, commandAction),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
  });

  it('fails url readback when no <link> action survives', async () => {
    const { result } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Open Product Details',
        sourceWorksheet: 'Profit',
        url: 'https://www.google.com/',
      },
      readbackXml: BASE_XML,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
  });

  it('fails url readback when the link expression persisted double-escaped', async () => {
    // A field reference that degraded to the double-escaped &amp;lt;[City]&amp;gt; form
    // unescapes to something other than the caller's raw url, so readback must report it
    // as not applied rather than a live URL action.
    const doubleEscaped =
      "<action caption='Search City' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<link caption='' expression='https://www.google.com/search?q=&amp;lt;[City]&amp;gt;' />" +
      '</action>';
    const { result } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Search City',
        sourceWorksheet: 'Profit',
        url: 'https://www.google.com/search?q=<[City]>',
      },
      readbackXml: withActions(BASE_XML, doubleEscaped),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
  });

  it('rejects a tsl:-prefixed url that would classify as a sheet-link filter', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Bad Scheme',
        sourceWorksheet: 'Profit',
        url: 'tsl:sheet=Overview',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('tsl:');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a pre-escaped url so a field reference cannot double-escape', async () => {
    // The tool escapes the url once. A caller that pre-escapes <[City]> to &lt;[City]&gt;
    // would have it escaped again into &amp;lt;[City]&amp;gt;, which renders as a literal
    // string instead of substituting the mark value. Reject it before it can persist.
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Pre Escaped',
        sourceWorksheet: 'Profit',
        url: 'https://www.google.com/search?q=&lt;[City]&gt;',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('must be passed unescaped');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('accepts a raw url with an ampersand query separator and escapes it once', async () => {
    // A literal & between query params is not an XML entity, so it must pass the
    // pre-escaped-input guard and be escaped exactly once to &amp; in the workbook.
    const expectedAction =
      "<action caption='Multi Param' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<link caption='' expression='https://example.com/?a=1&amp;b=2' />" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Multi Param',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/?a=1&b=2',
      },
      readbackXml: withActions(BASE_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
  });

  it('rejects a url action with no source', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'No Source',
        sourceWorksheet: '',
        url: 'https://example.com/',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('url mode requires a source');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a missing url in url mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'No Url',
        sourceWorksheet: 'Profit',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('url is required in url mode');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a parameter/set target in url mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Mixed',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/',
        targetParameter: '[Parameters].[Parameter 1]',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed in url mode');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects excludeSheets when a worksheet source is present', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Excludes',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Commission Model',
        excludeSheets: ['Sales'],
        url: 'https://example.com/',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('excludeSheets is only allowed');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('requires zoneId when urlTarget is specific-zone', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Zone',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/',
        urlTarget: 'specific-zone',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('zoneId is required');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects zoneId unless urlTarget is specific-zone', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Zone',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/',
        urlTarget: 'browser',
        zoneId: '4',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('zoneId is only allowed');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it.each(['0', 'abc', '4a', '-1', ' '])(
    'rejects a non-positive-integer zoneId (%j) in specific-zone mode',
    async (zoneId) => {
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          mode: 'url',
          caption: 'Zone',
          sourceWorksheet: 'Profit',
          url: 'https://example.com/',
          urlTarget: 'specific-zone',
          zoneId,
        },
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      // '0' and whitespace-only are caught by the required check / integer check;
      // both surface a zoneId error and never reach the apply path.
      expect(result.content[0].text).toMatch(/zoneId (must be a positive integer|is required)/);
      expect(applyWorkbookDocument).not.toHaveBeenCalled();
    },
  );

  it('rejects a duplicate url action with the same url and source', async () => {
    const existing =
      "<action caption='Existing URL' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<link caption='' expression='https://example.com/x' />" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'New URL',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/x',
      },
      initialXml: withActions(BASE_XML, existing),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('identical URL action');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('allows the same url from a different source', async () => {
    const existing =
      "<action caption='Existing URL' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<link caption='' expression='https://example.com/x' />" +
      '</action>';
    const added =
      "<action caption='Second URL' name='[Action2]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' dashboard='Commission Model' />" +
      "<link caption='' expression='https://example.com/x' />" +
      '</action>';
    const initialXml = withActions(BASE_XML, existing);
    const { result } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Second URL',
        sourceWorksheet: '',
        sourceDashboard: 'Commission Model',
        url: 'https://example.com/x',
      },
      initialXml,
      readbackXml: initialXml.replace('</actions>', `${added}</actions>`),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).actionName).toBe('[Action2]');
  });

  it('rejects a dashboard name slotted into sourceWorksheet and steers to sourceDashboard', async () => {
    // The reproduction of the edit-time crash: a dashboard name in sourceWorksheet would
    // emit <source worksheet='<dashboard>'>, which errors when the action is later edited.
    const withDashboard = BASE_XML.replace(
      '</workbook>',
      "<dashboards><dashboard name='Sales Dashboard' /></dashboards></workbook>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Open City',
        sourceWorksheet: 'Sales Dashboard',
        url: 'https://example.com/?q=<[City]>',
      },
      initialXml: withDashboard,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('is a dashboard, not a worksheet');
    expect(result.content[0].text).toContain('sourceDashboard');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a worksheet name slotted into sourceDashboard and steers to sourceWorksheet', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Open City',
        sourceWorksheet: '',
        sourceDashboard: 'Profit',
        url: 'https://example.com/',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('is a worksheet, not a dashboard');
    expect(result.content[0].text).toContain('sourceWorksheet');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('emits a dashboard-scoped url source when the dashboard is passed as sourceDashboard', async () => {
    const withDashboard = BASE_XML.replace(
      '</workbook>',
      "<dashboards><dashboard name='Sales Dashboard' /></dashboards></workbook>",
    );
    const expectedAction =
      "<action caption='Open City' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' dashboard='Sales Dashboard' />" +
      "<link caption='' expression='https://example.com/' />" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Open City',
        sourceWorksheet: '',
        sourceDashboard: 'Sales Dashboard',
        url: 'https://example.com/',
      },
      initialXml: withDashboard,
      readbackXml: withActions(withDashboard, expectedAction),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain("<source type='sheet' dashboard='Sales Dashboard' />");
    expect(loaded).not.toContain("worksheet='Sales Dashboard'");
  });

  it('detects caption collisions with plain <action> url elements', async () => {
    const existing =
      "<action caption='Dup' name='[Action1]'>" +
      "<source type='sheet' worksheet='Profit' />" +
      "<link caption='' expression='https://example.com/' />" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Dup',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/other',
      },
      initialXml: withActions(BASE_XML, existing),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('caption collision');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });
});

function withActions(baseXml: string, actionXml: string): string {
  const dsClose = baseXml.indexOf('</datasources>') + '</datasources>'.length;
  return baseXml.slice(0, dsClose) + `<actions>${actionXml}</actions>` + baseXml.slice(dsClose);
}

type AuthorActionArgs = {
  session?: string;
  mode?: 'parameter' | 'set' | 'url';
  caption: string;
  sourceWorksheet: string;
  sourceField?: string;
  targetParameter?: string;
  targetSet?: string;
  datasource?: string;
  setMembership?: 'assign' | 'add' | 'remove';
  clearSelection?: 'do-nothing' | 'show-all' | 'exclude-all';
  singleSelect?: boolean;
  activation?: 'on-select' | 'on-hover' | 'on-menu';
  url?: string;
  sourceDashboard?: string;
  excludeSheets?: string[];
  urlTarget?: 'default-zone-or-browser' | 'browser' | 'specific-zone';
  zoneId?: string;
  urlEncode?: boolean;
};

async function getToolResult({
  args,
  initialXml = BASE_XML,
  readbackXml,
}: {
  args: AuthorActionArgs;
  initialXml?: string;
  readbackXml?: string;
}): Promise<{
  result: CallToolResult;
  applyWorkbookDocument: ReturnType<typeof vi.fn>;
}> {
  const documents = [initialXml, initialXml, readbackXml ?? initialXml];
  let readCount = 0;
  const executeCommand = vi
    .fn()
    .mockResolvedValue(new Ok({ command_id: 'command-1', status: 'completed', result: null }));
  const getWorkbookDocument = vi.fn(async () => {
    return new Ok({
      xml: documents[Math.min(readCount++, documents.length - 1)],
      applicationVersion: undefined,
      xsdPayloadVersion: undefined,
    });
  });
  const applyWorkbookDocument = vi.fn(async () => {
    return new Ok({ command_id: 'apply-1', status: 'completed', result: null });
  });
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({
      executeCommand,
      getWorkbookDocument,
      applyWorkbookDocument,
    }),
  };
  const tool = getAuthorActionTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const result = await callback(
    {
      session: '12345',
      ...args,
      mode: args.mode ?? 'parameter',
      sourceField: args.sourceField,
      targetParameter: args.targetParameter,
      targetSet: args.targetSet,
      datasource: args.datasource,
      singleSelect: args.singleSelect,
      activation: args.activation ?? 'on-select',
      setMembership: args.setMembership ?? 'assign',
      clearSelection: args.clearSelection ?? 'do-nothing',
      url: args.url,
      sourceDashboard: args.sourceDashboard,
      excludeSheets: args.excludeSheets,
      urlTarget: args.urlTarget,
      zoneId: args.zoneId,
      urlEncode: args.urlEncode,
    },
    extra,
  );

  return { result, applyWorkbookDocument };
}

function appliedDocumentXml(applyWorkbookDocument: ReturnType<typeof vi.fn>): string {
  const [xml] = applyWorkbookDocument.mock.calls[0] ?? [];
  invariant(typeof xml === 'string');
  return xml;
}
