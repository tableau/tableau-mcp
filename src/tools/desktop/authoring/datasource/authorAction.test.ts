import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getAttr, getAuthorActionTool } from './authorAction.js';
import {
  appliedDocumentXml,
  BASE_XML,
  getToolResult,
  withActions,
} from './authorActionTestFixtures.js';

describe('getAttr', () => {
  it('reads the requested attribute', () => {
    expect(getAttr("<x name='B' />", 'name')).toBe('B');
    expect(getAttr('<x name="B" />', 'name')).toBe('B');
  });

  it('does not match a hyphen- or colon-suffixed decoy attribute', () => {
    expect(getAttr("<x param-name='A' name='B' />", 'name')).toBe('B');
    expect(getAttr("<x user:name='A' name='B' />", 'name')).toBe('B');
    expect(getAttr("<column semantic-role='A' role='B' />", 'role')).toBe('B');
  });

  it('returns the sole attribute even when it is only a decoy', () => {
    expect(getAttr("<x param-name='A' />", 'name')).toBeUndefined();
  });
});

describe('authorActionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('describes datasource selection as name or caption', async () => {
    const tool = getAuthorActionTool(new DesktopMcpServer());
    const paramsSchema = (await Provider.from(tool.paramsSchema)) as Record<
      string,
      { description?: string }
    >;

    expect(paramsSchema['datasource']?.description).toBe('Internal name or caption.');
  });

  it('tells the caller which field each mode requires up front', async () => {
    const tool = getAuthorActionTool(new DesktopMcpServer());
    const paramsSchema = (await Provider.from(tool.paramsSchema)) as Record<
      string,
      { description?: string }
    >;

    // The tool description tells the caller to pick a mode and pass its required field.
    expect(tool.description).not.toBe('Add action.');
    expect(tool.description).toContain('mode');

    // mode is the router: its description names each mode and the field that mode requires,
    // so the caller can populate it before the first call. This is where the tools/list byte
    // budget is best spent — one place, all four modes — rather than repeated per param.
    const modeDescription = paramsSchema['mode']?.description ?? '';
    for (const modeName of ['parameter', 'set', 'url', 'filter']) {
      expect(modeDescription).toContain(modeName);
    }
    expect(modeDescription).toContain('sourceField');
    expect(modeDescription).toContain('targetParameter');
    expect(modeDescription).toContain('targetSet');
    expect(modeDescription).toContain('targetSheet');

    // The four required mode-routing params each say which mode they belong to and, for the
    // parameter target, the qualified form — the specifics the mode summary can't carry.
    expect(paramsSchema['sourceField']?.description).toContain('parameter');
    expect(paramsSchema['targetParameter']?.description).toContain('[Parameters]');
    expect(paramsSchema['targetSet']?.description).toContain('set');
    expect(paramsSchema['targetSheet']?.description).toContain('filter');
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
      "<edit-parameter-action caption='Second' name='[Action2]'><agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' /><params><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action></actions>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Second',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
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

  // twb_2026.2.0.xsd fixes the child order of <actions>: legacy <action> (url/filter)
  // -> datasources/deps -> nav -> <edit-group-action> (set) -> <edit-parameter-action>
  // (parameter). A new action must slot into its family rather than append before </actions>
  it('inserts a url action ahead of an existing parameter action (XSD family order)', async () => {
    const existingParam =
      "<edit-parameter-action caption='Existing Param' name='[Action1]'></edit-parameter-action>";
    const initialXml = withActions(BASE_XML, existingParam);
    const added =
      "<action caption='Open Details' name='[Action2]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<link caption='' expression='https://example.com/' />" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Open Details',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/',
      },
      initialXml,
      readbackXml: withActions(BASE_XML, added + existingParam),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).actionName).toBe('[Action2]');

    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded.match(/<actions>/g)?.length).toBe(1);
    expect(loaded).toContain(added);
    const legacyAt = loaded.indexOf("<action caption='Open Details'");
    const paramAt = loaded.indexOf('<edit-parameter-action');
    expect(legacyAt).toBeGreaterThanOrEqual(0);
    expect(legacyAt).toBeLessThan(paramAt);
  });

  it('inserts a set action ahead of an existing parameter action (XSD family order)', async () => {
    const existingParam =
      "<edit-parameter-action caption='Existing Param' name='[Action1]'></edit-parameter-action>";
    const initialXml = withActions(BASE_XML, existingParam);
    const added =
      "<edit-group-action caption='Expand Category' name='[Action2]'>" +
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
      },
      initialXml,
      readbackXml: withActions(BASE_XML, added + existingParam),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).actionName).toBe('[Action2]');

    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded.match(/<actions>/g)?.length).toBe(1);
    expect(loaded).toContain(added);
    const groupAt = loaded.indexOf('<edit-group-action');
    const paramAt = loaded.indexOf('<edit-parameter-action');
    expect(groupAt).toBeGreaterThanOrEqual(0);
    expect(groupAt).toBeLessThan(paramAt);
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

  it('tells the caller to author a set first when the datasource has none', async () => {
    // The ticket's literal example was "targetSet is required in set mode. Available sets: none".
    // "none" alone left the agent retrying a set that never existed; name the recovery instead.
    const noSets = [
      "<?xml version='1.0' encoding='utf-8'?>",
      "<workbook version='18.1'>",
      '<datasources>',
      "<datasource caption='Sample - Superstore' name='federated.1syzfv90anwuu119p4zra1ga299n'>",
      "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
      '</datasource>',
      '</datasources>',
      "<worksheets><worksheet name='Profit' /></worksheets>",
      '</workbook>',
    ].join('');
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
      },
      initialXml: noSets,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('targetSet is required in set mode');
    expect(result.content[0].text).toContain('author one first with author-set');
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
        sourceField: '[Profit]',
        targetParameter: 'Parameter 1',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('[Parameters].[X]');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('requires sourceField in parameter mode and lists the available fields', async () => {
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
    // Recovery guidance: enumerate the fields the caller could drive the action from.
    expect(result.content[0].text).toContain('Available fields');
    expect(result.content[0].text).toContain('Profit');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects an empty or whitespace sourceField instead of applying a no-op action', async () => {
    // A blank sourceField would render an edit-parameter-action with a target but no
    // source-field param — a no-op that pushes no value yet passes readback (which only
    // checks the target survived). Reject it up front, same as an omitted sourceField.
    for (const sourceField of ['', '   ']) {
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          caption: 'Set Period',
          sourceWorksheet: 'Profit',
          sourceField,
          targetParameter: '[Parameters].[Parameter 1]',
        },
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('sourceField is required in parameter mode');
      expect(result.content[0].text).toContain('Available fields');
      expect(applyWorkbookDocument).not.toHaveBeenCalled();
    }
  });

  it('requires targetParameter in parameter mode and lists the existing parameters', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('targetParameter is required in parameter mode');
    // Recovery guidance: enumerate the parameters already in the workbook (the Parameters
    // datasource carries p.Period as [Parameter 1]).
    expect(result.content[0].text).toContain('Available parameters');
    expect(result.content[0].text).toContain('p.Period');
    expect(result.content[0].text).toContain('[Parameters].[Parameter 1]');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('tells the caller to author a parameter first when the workbook has none', async () => {
    // The LangSmith traces show the agent stuck retrying against a target that never existed:
    // "Available parameters: none" alone was a dead end. When the workbook carries no parameters,
    // the recovery is to author one first, so the message must name that path, not just "none".
    const noParameters = [
      "<?xml version='1.0' encoding='utf-8'?>",
      "<workbook version='18.1'>",
      '<datasources>',
      "<datasource caption='Sample - Superstore' name='federated.1syzfv90anwuu119p4zra1ga299n'>",
      "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
      '</datasource>',
      '</datasources>',
      "<worksheets><worksheet name='Profit' /></worksheets>",
      '</workbook>',
    ].join('');
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
      },
      initialXml: noParameters,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('targetParameter is required in parameter mode');
    expect(result.content[0].text).toContain('author one first with author-parameter');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a well-formed targetParameter that names no existing parameter', async () => {
    // [Parameters].[Profit] is correctly qualified but Profit is a data field, not a parameter.
    // Tableau would persist an action pointing at a phantom parameter that can never fire, so
    // reject it and list the parameters that do exist — as set mode does for an unknown set.
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
        targetParameter: '[Parameters].[Profit]',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'targetParameter "[Parameters].[Profit]" was not found',
    );
    expect(result.content[0].text).toContain('Available parameters');
    expect(result.content[0].text).toContain('p.Period');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('resolves a targetParameter named by its caption to the internal token', async () => {
    // A parameter's internal name ([Parameter 1]) is independent of its display caption
    // (p.Period). A caller who names the parameter by the caption they see in the Parameters
    // pane must still resolve — and the applied XML must carry the INTERNAL token, because that
    // is the only form Tableau resolves an action against. Mirrors set mode's caption handling.
    const readbackXml = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Set Period' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='Profit' /><agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' /><params><param name='source-field' value='[Profit]' /><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
        targetParameter: '[Parameters].[p.Period]',
        activation: 'on-select',
      },
      readbackXml,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    // The echo and emit both report the resolved internal token, not the caption input.
    expect(parsed.target).toBe('[Parameters].[Parameter 1]');
    expect(parsed.targetParameter).toBe('[Parameters].[Parameter 1]');
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(
      "<param name='target-parameter' value='[Parameters].[Parameter 1]' />",
    );
    // The raw caption must never reach the serialized XML.
    expect(loaded).not.toContain('[Parameters].[p.Period]');
  });

  it('echoes the default aggregation and clear behavior when neither is set', async () => {
    // Neither sourceFieldAggregation nor clearValue passed: the emitted XML is byte-identical to
    // what the tool has always emitted (attr + do-nothing), and the receipt reports those defaults.
    const readbackXml = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Set Period' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='Profit' /><agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' /><params><param name='source-field' value='[Profit]' /><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
        targetParameter: '[Parameters].[Parameter 1]',
      },
      readbackXml,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sourceFieldAggregation).toBe('attr');
    expect(parsed.clearValue).toBeUndefined();
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain("<agg-type type='attr' />");
    expect(loaded).toContain("<clear-option type='do-nothing' value='s:LROOT:' />");
  });

  it('passes readback when Desktop rewrites the do-nothing clear value to the param default', async () => {
    // Field-observed: for clear-option type='do-nothing', Desktop discards the emitted
    // value='s:LROOT:' and stamps the target parameter's OWN default in its datatype encoding
    // (here 'i:1' for an integer param). The clear-option value is Desktop-owned; only its type is
    // author-controlled. Readback must accept the type it authored, not demand the exact value it
    // sent survive a round-trip — else every default apply falsely reports "did not survive".
    const readbackXml = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Set Period' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='Profit' /><agg-type type='attr' /><clear-option type='do-nothing' value='i:1' /><params><param name='source-field' value='[Profit]' /><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>",
    );
    const { result } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
        targetParameter: '[Parameters].[Parameter 1]',
      },
      readbackXml,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.clearValue).toBeUndefined();
  });

  it('offers sourceFieldAggregation as a fixed set of Tableau aggregations, not a free string', async () => {
    // The aggregation is a closed set (twb XSD ActionList-Agg-ST), so it is an enum dropdown like
    // activation/setMembership — the schema rejects a non-token up front. 'none' is NOT offered:
    // Desktop backfills <agg-type type='attr'/> when the element is omitted (field-observed), so a
    // 'none' that omits it can never survive readback and would be a value that does nothing.
    const tool = getAuthorActionTool(new DesktopMcpServer());
    const paramsSchema = (await Provider.from(tool.paramsSchema)) as Record<
      string,
      { safeParse: (value: unknown) => { success: boolean } }
    >;
    const agg = paramsSchema['sourceFieldAggregation'];
    expect(agg.safeParse('attr').success).toBe(true);
    expect(agg.safeParse('sum').success).toBe(true);
    expect(agg.safeParse('bogus').success).toBe(false);
    expect(agg.safeParse('none').success).toBe(false);
  });

  it('emits the requested source-field aggregation', async () => {
    // sourceFieldAggregation='sum' overrides the pinned 'attr'; the <agg-type> type attribute
    // carries it and the receipt echoes it back.
    const readbackXml = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Set Period' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='Profit' /><agg-type type='sum' /><clear-option type='do-nothing' value='s:LROOT:' /><params><param name='source-field' value='[Profit]' /><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
        targetParameter: '[Parameters].[Parameter 1]',
        sourceFieldAggregation: 'sum',
      },
      readbackXml,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sourceFieldAggregation).toBe('sum');
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain("<agg-type type='sum' />");
  });

  it('resets the parameter to a fixed value on clear when clearValue is set', async () => {
    // A clearValue turns the clear-option into assign-fixed-value carrying s:LROOT:<value>, so
    // deselecting a mark resets the parameter to that value instead of leaving it unchanged.
    const readbackXml = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Set Period' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='Profit' /><agg-type type='attr' /><clear-option type='assign-fixed-value' value='s:LROOT:Month' /><params><param name='source-field' value='[Profit]' /><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
        targetParameter: '[Parameters].[Parameter 1]',
        clearValue: 'Month',
      },
      readbackXml,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.clearValue).toBe('Month');
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain("<clear-option type='assign-fixed-value' value='s:LROOT:Month' />");
  });

  it('fails readback when the requested aggregation did not survive', async () => {
    // The tool authored agg-type='sum' but the readback shows the workbook kept 'attr' — a dropped
    // setting. Readback must catch it rather than report the requested aggregation as applied.
    const driftedReadback = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Set Period' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='Profit' /><agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' /><params><param name='source-field' value='[Profit]' /><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>",
    );
    const { result } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
        targetParameter: '[Parameters].[Parameter 1]',
        sourceFieldAggregation: 'sum',
      },
      readbackXml: driftedReadback,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
  });

  it('fails readback when the fixed clear value did not survive', async () => {
    // The tool authored assign-fixed-value but the readback shows do-nothing — the reset behavior
    // was dropped, so the receipt must not report it as applied.
    const driftedReadback = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Set Period' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='Profit' /><agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' /><params><param name='source-field' value='[Profit]' /><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>",
    );
    const { result } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
        targetParameter: '[Parameters].[Parameter 1]',
        clearValue: 'Month',
      },
      readbackXml: driftedReadback,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
  });

  it('rejects clearValue against a non-string parameter', async () => {
    // clearValue is encoded with the string prefix (s:LROOT:) regardless of the target parameter's
    // datatype, so applying it to an integer parameter writes a malformed clear-option that Desktop
    // silently rewrites — and readback can't catch it (it checks the clear-option type, not its
    // value). Until the tool encodes per datatype, reject clearValue on non-string parameters.
    const intParamXml = [
      "<?xml version='1.0' encoding='utf-8'?>",
      "<workbook version='18.1'>",
      '<datasources>',
      "<datasource hasconnection='false' inline='true' name='Parameters'>",
      "<column caption='p.Count' datatype='integer' name='[Parameter 1]' param-domain-type='range' role='measure' type='quantitative' value='1'><calculation class='tableau' formula='1' /></column>",
      '</datasource>',
      "<datasource caption='Sample - Superstore' name='federated.1syzfv90anwuu119p4zra1ga299n'>",
      "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
      '</datasource>',
      '</datasources>',
      "<worksheets><worksheet name='Profit' /></worksheets>",
      '</workbook>',
    ].join('');
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Count',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
        targetParameter: '[Parameters].[Parameter 1]',
        clearValue: '5',
      },
      initialXml: intParamXml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('clearValue');
    expect(result.content[0].text).toContain('string');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a sourceWorksheet that names no existing worksheet', async () => {
    // "Sales Map" looks plausible but the workbook only has "Profit"; a phantom source persists
    // as an action that can never fire. Reject it and enumerate the real worksheets.
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Sales Map',
        sourceField: '[Profit]',
        targetParameter: '[Parameters].[Parameter 1]',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('sourceWorksheet "Sales Map" was not found');
    expect(result.content[0].text).toContain('Available worksheets');
    expect(result.content[0].text).toContain('Profit');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a set-mode sourceWorksheet that names no existing worksheet', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Sales Map',
        targetSet: 'Category Set',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('sourceWorksheet "Sales Map" was not found');
    expect(result.content[0].text).toContain('Available worksheets');
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
        sourceField: '[Profit]',
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
        excludeSourceSheets: ['Sales', 'OTE'],
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

  it('rejects excludeSourceSheets when a worksheet source is present', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Excludes',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Commission Model',
        excludeSourceSheets: ['Sales'],
        url: 'https://example.com/',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('excludeSourceSheets is only allowed');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects excludeTargetSheets in url mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Excludes',
        sourceWorksheet: '',
        sourceDashboard: 'Commission Model',
        excludeTargetSheets: ['Sales'],
        url: 'https://example.com/',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('excludeTargetSheets is only allowed in filter mode');
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
