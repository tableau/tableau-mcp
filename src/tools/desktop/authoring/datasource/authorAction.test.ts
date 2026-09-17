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

  it('describes datasource selection as name or unique caption', async () => {
    const tool = getAuthorActionTool(new DesktopMcpServer());
    const paramsSchema = (await Provider.from(tool.paramsSchema)) as Record<
      string,
      { description?: string }
    >;

    expect(paramsSchema['datasource']?.description).toBe(
      'Internal datasource name or unique caption.',
    );
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

  it('resolves a unique datasource caption to the internal set target', async () => {
    const expectedAction =
      "<edit-group-action caption='Expand Category' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<add-or-remove-marks value='assign' />" +
      "<params><param name='selection-clear-set-option' value='do-nothing' />" +
      "<param name='target-group' value='[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]' /></params>" +
      '</edit-group-action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        targetSet: 'Category Set',
        datasource: 'Sample - Superstore',
      },
      readbackXml: withActions(BASE_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).targetSet).toBe(
      '[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]',
    );
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('rejects a duplicate datasource caption before applying a set action', async () => {
    const duplicateCaptionXml = BASE_XML.replace(
      '</datasources>',
      "<datasource caption='Sample - Superstore' name='federated.duplicate'></datasource></datasources>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        targetSet: 'Category Set',
        datasource: 'Sample - Superstore',
      },
      initialXml: duplicateCaptionXml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('ambiguous');
    expect(result.content[0].text).toContain('federated.1syzfv90anwuu119p4zra1ga299n');
    expect(result.content[0].text).toContain('federated.duplicate');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
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
    expect(result.content[0].text).toContain('Datasource "phantom" was not found');
    expect(result.content[0].text).not.toContain('Candidates: phantom');
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
    expect(result.content[0].text).toContain('Datasource "Missing Datasource" was not found');
    expect(result.content[0].text).toContain('federated.1syzfv90anwuu119p4zra1ga299n');
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
      '<activation />' +
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
    expect(loaded).toContain('<activation />');
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

  
  const FILTER_XML = BASE_XML.replace(
    "<worksheets><worksheet name='Profit' /></worksheets>",
    "<worksheets><worksheet name='Profit' /><worksheet name='Details' /></worksheets>",
  );
  const FILTER_DASH_XML = FILTER_XML.replace(
    '</workbook>',
    "<dashboards><dashboard name='Overview' /></dashboards></workbook>",
  );
  const FILTER_DASH_MEMBER_XML = FILTER_XML.replace(
    '</workbook>',
    "<dashboards><dashboard name='Overview'><zones>" +
      "<zone name='Profit' /><zone name='Details' />" +
      '</zones></dashboard></dashboards></workbook>',
  );
  const FILTER_DASH_TARGET_ONLY_XML = FILTER_XML.replace(
    '</workbook>',
    "<dashboards><dashboard name='Overview'><zones>" +
      "<zone name='Details' />" +
      '</zones></dashboard></dashboards></workbook>',
  );

  const FILTER_DS_NAME = 'federated.1syzfv90anwuu119p4zra1ga299n';
  const FILTER_DS_CAPTION = 'Sample - Superstore';
  const withFilterFields = (xml: string): string =>
    xml.replace(
      "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
      "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />" +
        "<column caption='Category' datatype='string' name='[Category]' role='dimension' type='nominal' />" +
        "<column caption='Sub-Category' datatype='string' name='[Sub-Category]' role='dimension' type='nominal' />",
    );
  const FILTER_FIELDS_XML = withFilterFields(FILTER_XML);
  const FILTER_FIELDS_DASH_XML = withFilterFields(FILTER_DASH_MEMBER_XML);

  const filterLink = (caption: string, expression: string): string =>
    `<link caption='${caption}' delimiter=',' escape='\\' expression='${expression}' include-null='true' multi-select='true' url-escape='true' />`;
  const dependencyColumn = (field: string): string =>
    `<column datatype='string' name='[${field}]' role='dimension' type='nominal' />`;
  const filterDependencyBlocks = (fields: string[]): string =>
    `<datasources><datasource caption='${FILTER_DS_CAPTION}' name='${FILTER_DS_NAME}' /></datasources>` +
    `<datasource-dependencies datasource='${FILTER_DS_NAME}'>${fields.map(dependencyColumn).join('')}</datasource-dependencies>`;

  it('emits a byte-faithful all-fields filter action and verifies readback', async () => {
    const expectedAction =
      "<action caption='Filter to Details' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Filter to Details',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml: FILTER_XML,
      readbackXml: withActions(FILTER_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.mode).toBe('filter');
    expect(parsed.actionName).toBe('[Action1]');
    expect(parsed.target).toBe('Details');
    expect(parsed.targetSheet).toBe('Details');

    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
        expect(loaded).not.toContain('<edit-parameter-action');
    expect(loaded).not.toContain('<edit-group-action');
  });

  it.each([
    ['do-nothing', "<activation type='on-select' />", ''],
    ['show-all', "<activation auto-clear='true' type='on-select' />", ''],
    [
      'exclude-all',
      "<activation auto-clear='true' type='on-select' />",
      "<param name='on-empty' value='none' />",
    ],
  ] as const)(
    'maps clearSelection %s to the Desktop dialog activation/on-empty pair',
    async (clearSelection, expectedActivation, expectedOnEmpty) => {
      const expectedAction =
        "<action caption='Cross Filter' name='[Action1]'>" +
        expectedActivation +
        "<source type='sheet' worksheet='Profit' />" +
        "<command command='tsc:tsl-filter'>" +
        expectedOnEmpty +
        "<param name='special-fields' value='all' />" +
        "<param name='target' value='Details' /></command>" +
        '</action>';
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          mode: 'filter',
          caption: 'Cross Filter',
          sourceWorksheet: 'Profit',
          targetSheet: 'Details',
          clearSelection,
        },
        initialXml: FILTER_XML,
        readbackXml: withActions(FILTER_XML, expectedAction),
      });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text).clearSelection).toBe(clearSelection);
      expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
    },
  );

  it.each([
    ['on-hover', "<activation type='on-hover' />"],
    ['on-menu', '<activation />'],
  ] as const)(
    'honors the %s activation ("Action" setting) for filter actions',
    async (activation, activationXml) => {
      const expectedAction =
        "<action caption='Cross Filter' name='[Action1]'>" +
        activationXml +
        "<source type='sheet' worksheet='Profit' />" +
        "<command command='tsc:tsl-filter'>" +
        "<param name='special-fields' value='all' />" +
        "<param name='target' value='Details' /></command>" +
        '</action>';
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          mode: 'filter',
          caption: 'Cross Filter',
          sourceWorksheet: 'Profit',
          targetSheet: 'Details',
          activation,
        },
        initialXml: FILTER_XML,
        readbackXml: withActions(FILTER_XML, expectedAction),
      });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text).activation).toBe(activation);
      expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
    },
  );

  it('emits single-select as a presence-only command param in alphabetical order and echoes it', async () => {
                    const expectedAction =
      "<action caption='Cross Filter' name='[Action1]'>" +
      "<activation auto-clear='true' type='on-select' />" +
      "<source type='sheet' worksheet='Profit' dashboard='Overview' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='exclude' value='Profit' />" +
      "<param name='on-empty' value='none' />" +
      "<param name='single-select' value='' />" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Cross Filter',
        sourceDashboard: 'Overview',
        sourceWorksheet: 'Profit',
        targetSheet: 'Overview',
        excludeSheets: ['Profit'],
        clearSelection: 'exclude-all',
        singleSelect: true,
      },
      initialXml: FILTER_DASH_MEMBER_XML,
      readbackXml: withActions(FILTER_DASH_MEMBER_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).singleSelect).toBe(true);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('omits the single-select param for a multi-select (default) filter action', async () => {
            const expectedAction =
      "<action caption='Cross Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Cross Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        singleSelect: false,
      },
      initialXml: FILTER_XML,
      readbackXml: withActions(FILTER_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).singleSelect).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).not.toContain('single-select');
    expect(loaded).toContain(expectedAction);
  });

  it('emits a tsl: <link> plus datasource-dependencies for a specific-field filter, never field-captions', async () => {
    const expectedAction =
      "<action caption='Filter Selected' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink(
        'Filter Selected',
        'tsl:Details?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;&amp;%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const expectedBlocks = filterDependencyBlocks(['Category', 'Sub-Category']);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Filter Selected',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        filterFields: ['Category', 'Sub-Category'],
      },
      initialXml: FILTER_FIELDS_XML,
      readbackXml: withActions(FILTER_FIELDS_XML, expectedAction + expectedBlocks),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).toContain(expectedBlocks);
        expect(loaded).toContain(
      "expression='tsl:Details?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;&amp;%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;'",
    );
        expect(loaded).not.toContain('field-captions');
    expect(loaded).not.toContain('special-fields');
  });

  it('rejects a specific-field filter naming a field absent from the datasource', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Bad Field',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        filterFields: ['Nonexistent'],
      },
      initialXml: FILTER_FIELDS_XML,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('was not found in datasource');
    expect(result.content[0].text).toContain('Available fields:');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('emits an exclude param and a dashboard-scoped source', async () => {
    const expectedAction =
      "<action caption='Dash Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' dashboard='Overview' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='exclude' value='Profit' />" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Dash Filter',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Overview',
        targetSheet: 'Overview',
        excludeSheets: ['Profit'],
      },
      initialXml: FILTER_DASH_XML,
      readbackXml: withActions(FILTER_DASH_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('does not auto-scope or self-exclude a dashboard target that hosts the source', async () => {
    const expectedAction =
      "<action caption='External' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'External',
        sourceWorksheet: 'Profit',
        targetSheet: 'Overview',
      },
      initialXml: FILTER_DASH_MEMBER_XML,
      readbackXml: withActions(FILTER_DASH_MEMBER_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
        expect(loaded).not.toContain("<param name='exclude'");
    expect(loaded).not.toContain("dashboard='Overview'");
  });

  it('keeps a worksheet target as a worksheet action even when both sheets sit on a dashboard', async () => {
    const expectedAction =
      "<action caption='Cross Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Cross Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml: FILTER_DASH_MEMBER_XML,
      readbackXml: withActions(FILTER_DASH_MEMBER_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.target).toBe('Details');
    expect(parsed.targetSheet).toBe('Details');
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('keeps a self-filtering worksheet action on the worksheet, not its dashboard', async () => {
    const expectedAction =
      "<action caption='Self Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink(
        'Self Filter',
        'tsl:Profit?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;&amp;%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Profit' /></command>" +
      '</action>';
    const expectedBlocks = filterDependencyBlocks(['Category', 'Sub-Category']);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Self Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Profit',
        filterFields: ['Category', 'Sub-Category'],
      },
      initialXml: FILTER_FIELDS_DASH_XML,
      readbackXml: withActions(FILTER_FIELDS_DASH_XML, expectedAction + expectedBlocks),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.target).toBe('Profit');
    expect(parsed.targetSheet).toBe('Profit');
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).toContain(expectedBlocks);
            expect(loaded).toContain(
      "expression='tsl:Profit?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;&amp;%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;'",
    );
    expect(loaded).not.toContain('field-captions');
  });

  it('keeps field clauses for a dashboard self-filter (source dashboard equals the target)', async () => {
            const expectedAction =
      "<action caption='Category Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' dashboard='Overview' />" +
      filterLink(
        'Category Filter',
        'tsl:Overview?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const expectedBlocks = filterDependencyBlocks(['Category']);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Category Filter',
        sourceWorksheet: '',
        sourceDashboard: 'Overview',
        targetSheet: 'Overview',
        filterFields: ['Category'],
      },
      initialXml: FILTER_FIELDS_DASH_XML,
      readbackXml: withActions(FILTER_FIELDS_DASH_XML, expectedAction + expectedBlocks),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).toContain(expectedBlocks);
            expect(loaded).toContain(
      "expression='tsl:Overview?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;'",
    );
    expect(loaded).not.toContain('field-captions');
    expect(loaded).not.toContain('special-fields');
  });

  it('keeps field clauses when a viz-within-a-dashboard filters its own dashboard', async () => {
                const expectedAction =
      "<action caption='Region Cross Filter' name='[Action1]'>" +
      "<activation auto-clear='true' type='on-select' />" +
      "<source type='sheet' worksheet='Profit' dashboard='Overview' />" +
      filterLink(
        'Region Cross Filter',
        'tsl:Overview?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;&amp;%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='exclude' value='Profit' />" +
      "<param name='on-empty' value='none' />" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const expectedBlocks = filterDependencyBlocks(['Category', 'Sub-Category']);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Region Cross Filter',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Overview',
        targetSheet: 'Overview',
        filterFields: ['Category', 'Sub-Category'],
        excludeSheets: ['Profit'],
        clearSelection: 'exclude-all',
      },
      initialXml: FILTER_FIELDS_DASH_XML,
      readbackXml: withActions(FILTER_FIELDS_DASH_XML, expectedAction + expectedBlocks),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).toContain(expectedBlocks);
    expect(loaded).not.toContain('field-captions');
    expect(loaded).not.toContain('special-fields');
  });

  it('keeps the requested field list when a worksheet filters a dashboard target', async () => {
    const expectedAction =
      "<action caption='Dash Cross Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink(
        'Dash Cross Filter',
        'tsl:Overview?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;&amp;%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const expectedBlocks = filterDependencyBlocks(['Category', 'Sub-Category']);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Dash Cross Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Overview',
        filterFields: ['Category', 'Sub-Category'],
      },
      initialXml: FILTER_FIELDS_DASH_XML,
      readbackXml: withActions(FILTER_FIELDS_DASH_XML, expectedAction + expectedBlocks),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).toContain(expectedBlocks);
    expect(loaded).not.toContain('field-captions');
    expect(loaded).not.toContain('special-fields');
  });

  it('honors a worksheet target even when sourceDashboard names the source dashboard', async () => {
            const expectedAction =
      "<action caption='Scoped Source' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' dashboard='Overview' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Scoped Source',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Overview',
        targetSheet: 'Details',
      },
      initialXml: FILTER_DASH_MEMBER_XML,
      readbackXml: withActions(FILTER_DASH_MEMBER_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).target).toBe('Details');
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('keeps a plain sheet-to-sheet filter a worksheet action', async () => {
        const expectedAction =
      "<action caption='Plain Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Plain Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml: FILTER_DASH_TARGET_ONLY_XML,
      readbackXml: withActions(FILTER_DASH_TARGET_ONLY_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).target).toBe('Details');
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('appends a filter action into an existing <actions> block with a fresh name', async () => {
    const existing =
      "<edit-parameter-action caption='Existing' name='[Action1]'></edit-parameter-action>";
    const initialXml = withActions(FILTER_XML, existing);
    const added =
      "<action caption='Cross Filter' name='[Action2]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Cross Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml,
      readbackXml: initialXml.replace('</actions>', `${added}</actions>`),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).actionName).toBe('[Action2]');
    expect(appliedDocumentXml(applyWorkbookDocument).match(/<actions>/g)?.length).toBe(1);
  });

  it('requires targetSheet in filter mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'No Target',
        sourceWorksheet: 'Profit',
      },
      initialXml: FILTER_XML,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('targetSheet is required in filter mode');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a parameter target in filter mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Mixed',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        targetParameter: '[Parameters].[Parameter 1]',
      },
      initialXml: FILTER_XML,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed in filter mode');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a filter action with no source', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'No Source',
        sourceWorksheet: '',
        targetSheet: 'Details',
      },
      initialXml: FILTER_XML,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('filter mode requires a source');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a targetSheet that is not a real sheet or dashboard', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Typo Target',
        sourceWorksheet: 'Profit',
        targetSheet: 'Detials',
      },
      initialXml: FILTER_XML,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('was not found');
    expect(result.content[0].text).toContain('Details');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('fails filter readback when the tsl-filter target is absent', async () => {
    const incompleteAction =
      "<action caption='Filter to Details' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'><param name='special-fields' value='all' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Filter to Details',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml: FILTER_XML,
      readbackXml: withActions(FILTER_XML, incompleteAction),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain("value='Details'");
  });

  it('rejects a duplicate filter action with the same source and target', async () => {
    const existing =
      "<action caption='Existing Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'New Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml: withActions(FILTER_XML, existing),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('identical filter action');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a duplicate filter action regardless of the stored attribute order', async () => {
            const existing =
      "<action name='[Action1]' caption='Existing Filter'>" +
      "<activation type='on-select' />" +
      "<source worksheet='Profit' type='sheet' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Details' />" +
      "<param name='special-fields' value='all' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'New Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml: withActions(FILTER_XML, existing),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('identical filter action');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });
});

function withActions(baseXml: string, actionXml: string): string {
  const dsClose = baseXml.indexOf('</datasources>') + '</datasources>'.length;
  return baseXml.slice(0, dsClose) + `<actions>${actionXml}</actions>` + baseXml.slice(dsClose);
}

type AuthorActionArgs = {
  session?: string;
  mode?: 'parameter' | 'set' | 'url' | 'filter';
  caption: string;
  sourceWorksheet: string;
  sourceField?: string;
  targetParameter?: string;
  targetSet?: string;
  targetSheet?: string;
  filterFields?: string[];
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
      targetSheet: args.targetSheet,
      filterFields: args.filterFields,
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
