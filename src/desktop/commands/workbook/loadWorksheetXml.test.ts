import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../../logging/logger.js';
import invariant from '../../../utils/invariant.js';
import { normalizeArray, parseXML } from '../../metadata/parser.js';
import { extractSheetXml } from '../../metadata/sheets.js';
import { deriveWorksheetApplyState } from '../../metadata/targetWorksheetState.js';
import type { ParsedWindow } from '../../metadata/types.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
import * as validationRegistry from '../../validation/registry.js';
import { loadWorksheetXml } from './loadWorksheetXml.js';

const sheetUpsertMock = vi.hoisted(() => ({
  upsertSheetIntoWorkbook: undefined as
    | undefined
    | ((
        workbookXml: string,
        sheetName: string,
        editedWorksheetXml: string,
        editedWorksheetWindowXml?: string,
      ) => string),
}));

vi.mock('../../metadata/sheets.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../metadata/sheets.js')>();
  return {
    ...actual,
    upsertSheetIntoWorkbook: (
      workbookXml: string,
      sheetName: string,
      editedWorksheetXml: string,
      editedWorksheetWindowXml?: string,
    ) =>
      sheetUpsertMock.upsertSheetIntoWorkbook
        ? sheetUpsertMock.upsertSheetIntoWorkbook(
            workbookXml,
            sheetName,
            editedWorksheetXml,
            editedWorksheetWindowXml,
          )
        : actual.upsertSheetIntoWorkbook(
            workbookXml,
            sheetName,
            editedWorksheetXml,
            editedWorksheetWindowXml,
          ),
  };
});

describe('loadWorksheetXml (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  const worksheetName = 'Sheet 1';
  const validXml = `<worksheet name='${worksheetName}'><table><rows /></table></worksheet>`;

  function liveWorkbook(worksheetNames: string[], dashboardNames: string[] = []): string {
    const worksheets = worksheetNames
      .map((name) => `<worksheet name='${name}'><table /></worksheet>`)
      .join('');
    const dashboards = dashboardNames
      .map((name) => `<dashboard name='${name}'><zones /></dashboard>`)
      .join('');
    const windows = worksheetNames
      .map((name) => `<window class='worksheet' name='${name}' />`)
      .join('');
    const dashboardsBlock = dashboards ? `<dashboards>${dashboards}</dashboards>` : '';
    return `<?xml version='1.0'?><workbook><worksheets>${worksheets}</worksheets>${dashboardsBlock}<windows>${windows}</windows></workbook>`;
  }

  function dispatchingExecutor(workbookXml: string): {
    executor: ToolExecutor;
    calls: Array<{
      kind: 'command' | 'apply';
      namespace?: string;
      command?: string;
      args?: Record<string, unknown>;
      xml?: string;
    }>;
  } {
    const calls: Array<{
      kind: 'command' | 'apply';
      namespace?: string;
      command?: string;
      args?: Record<string, unknown>;
      xml?: string;
    }> = [];
    const executeCommand = vi.fn(async (params: any) => {
      calls.push({
        kind: 'command',
        namespace: params.namespace,
        command: params.command,
        args: params.args,
      });
      return Ok({ command_id: 'cmd-ok', status: 'completed', submitted_at: '' });
    });
    const getWorkbookDocument = vi
      .fn()
      .mockResolvedValue(
        Ok({ xml: workbookXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      );
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      calls.push({ kind: 'apply', xml });
      return Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' });
    });
    return {
      executor: {
        executeCommand,
        getWorkbookDocument,
        applyWorkbookDocument,
        listWorksheets: vi
          .fn()
          .mockResolvedValue(Ok({ worksheets: [{ id: 'sheet-1', name: worksheetName }] })),
      } as unknown as ToolExecutor,
      calls,
    };
  }

  function statefulExecutor(initialWorkbookXml: string): {
    executor: ToolExecutor;
    appliedDocuments: string[];
  } {
    let liveWorkbookXml = initialWorkbookXml;
    const appliedDocuments: string[] = [];
    const executor = {
      getWorkbookDocument: vi.fn(async () =>
        Ok({
          xml: liveWorkbookXml,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
      applyWorkbookDocument: vi.fn(async (xml: string) => {
        appliedDocuments.push(xml);
        liveWorkbookXml = xml;
        return Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' });
      }),
      listWorksheets: vi.fn(async () =>
        Ok({ worksheets: [{ id: 'sheet-1', name: worksheetName }] }),
      ),
      getWorksheetDocument: vi.fn(async () =>
        Ok({ xml: extractSheetXml(liveWorkbookXml, worksheetName) ?? '' }),
      ),
    } as unknown as ToolExecutor;

    return { executor, appliedDocuments };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sheetUpsertMock.upsertSheetIntoWorkbook = undefined;
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('upserts the edited sheet into the whole live workbook, preserving siblings and dashboards', async () => {
    const { executor, calls } = dispatchingExecutor(
      liveWorkbook(['Sheet 1', 'Other'], ['Dashboard 1']),
    );

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.find((c) => c.command === 'delete-sheet')).toBeUndefined();

    const applyCall = calls.find((c) => c.kind === 'apply');
    expect(typeof applyCall?.xml).toBe('string');
    expect(applyCall?.xml).toContain('name="Sheet 1"');
    // The POST replaces the open workbook wholesale, so the sibling sheet and the live dashboard
    // MUST survive in the posted doc — omitting them would prune them from Desktop.
    expect(applyCall?.xml).toContain('name="Other"');
    expect(applyCall?.xml).toContain('name="Dashboard 1"');
  });

  it('preserves the generic one-GET apply path when no confirmed state is supplied', async () => {
    const sourceWorkbook = `<?xml version='1.0'?><workbook>
      <worksheets>
        <worksheet name='Sheet 1'><table /></worksheet>
        <worksheet name='Other'><table><rows /></table></worksheet>
      </worksheets>
      <windows>
        <window class='worksheet' name='Sheet 1' />
        <window class='worksheet' name='Other' />
      </windows>
    </workbook>`;
    const laterWorkbook = sourceWorkbook.replace('<rows />', '<cols />');
    const appliedDocuments: string[] = [];
    const executor = {
      getWorkbookDocument: vi
        .fn()
        .mockResolvedValueOnce(
          Ok({ xml: sourceWorkbook, applicationVersion: undefined, xsdPayloadVersion: undefined }),
        )
        .mockResolvedValue(
          Ok({ xml: laterWorkbook, applicationVersion: undefined, xsdPayloadVersion: undefined }),
        ),
      applyWorkbookDocument: vi.fn(async (xml: string) => {
        appliedDocuments.push(xml);
        return Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' });
      }),
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: 'sheet-1', name: worksheetName }] })),
      getWorksheetDocument: vi.fn(async () => Ok({ xml: validXml })),
    } as unknown as ToolExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(executor.getWorkbookDocument).toHaveBeenCalledOnce();
    expect(appliedDocuments).toHaveLength(1);
    expect(appliedDocuments[0]).toContain('<rows>');
    expect(appliedDocuments[0]).not.toContain('<cols>');
  });

  it('preserves the live active window and does not navigate after apply', async () => {
    const workbookXml = `<?xml version='1.0'?><workbook>
      <worksheets>
        <worksheet name='Sheet 1'><table /></worksheet>
        <worksheet name='Sheet 2'><table /></worksheet>
      </worksheets>
      <windows>
        <window class='worksheet' name='Sheet 1' />
        <window class='worksheet' name='Sheet 2' active='true' maximized='true' />
      </windows>
    </workbook>`;
    const { executor, calls } = dispatchingExecutor(workbookXml);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    const appliedXml = calls.find((call) => call.kind === 'apply')?.xml;
    expect(appliedXml).toBeDefined();
    const windows = normalizeArray<ParsedWindow>(parseXML(appliedXml!).workbook?.windows?.window);
    expect(windows.map((window) => window['@_name'])).toEqual(['Sheet 1', 'Sheet 2']);
    expect(windows[0]).not.toHaveProperty('@_active');
    expect(windows[0]).not.toHaveProperty('@_maximized');
    expect(windows[1]).toMatchObject({ '@_active': 'true', '@_maximized': 'true' });
    expect(calls.some((call) => call.command === 'goto-sheet')).toBe(false);
  });

  it('appends a brand-new sheet while preserving the existing one', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Some Other Sheet']));

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.find((c) => c.command === 'delete-sheet')).toBeUndefined();
    const applyCall = calls.find((c) => c.kind === 'apply');
    expect(applyCall).toBeDefined();
    expect(applyCall?.xml).toContain('class="worksheet" name="Sheet 1"');
    expect(applyCall?.xml).toContain('name="Some Other Sheet"');
  });

  it('refuses when an expected-absent target appeared after preview', async () => {
    const previewWorkbook = liveWorkbook([]);
    const { executor, appliedDocuments } = statefulExecutor(liveWorkbook([worksheetName]));

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      expectedState: deriveWorksheetApplyState(previewWorkbook, worksheetName, validXml),
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error).toMatchObject({
        type: 'preview-state-changed',
        message: expect.stringMatching(/changed after preview.*rebuilt.*reconfirmed/i),
      });
    }
    expect(appliedDocuments).toHaveLength(0);
  });

  it('refuses before POST when the incoming worksheet differs from the confirmed artifact', async () => {
    const previewWorkbook = liveWorkbook([worksheetName]);
    const confirmedXml = `<worksheet name='${worksheetName}'><table><rows /></table></worksheet>`;
    const { executor, appliedDocuments } = statefulExecutor(previewWorkbook);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: `<worksheet name='${worksheetName}'><table><cols /></table></worksheet>`,
      expectedState: deriveWorksheetApplyState(previewWorkbook, worksheetName, confirmedXml),
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error).toMatchObject({
        type: 'preview-state-changed',
        message: expect.stringMatching(/confirmed artifact.*reconfirmed/i),
      });
    }
    expect(appliedDocuments).toHaveLength(0);
  });

  it('refuses before POST when the incoming worksheet window differs from the confirmed artifact', async () => {
    const previewWorkbook = liveWorkbook([worksheetName]);
    const confirmedWindow = `<window class='worksheet' name='${worksheetName}'><cards><card type='filters' /></cards></window>`;
    const { executor, appliedDocuments } = statefulExecutor(previewWorkbook);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      worksheetWindowXml: `<window class='worksheet' name='${worksheetName}'><cards><card type='marks' /></cards></window>`,
      expectedState: deriveWorksheetApplyState(
        previewWorkbook,
        worksheetName,
        validXml,
        confirmedWindow,
      ),
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    expect(appliedDocuments).toHaveLength(0);
  });

  it('refuses when the target worksheet changed after preview', async () => {
    const previewWorkbook = `<?xml version='1.0'?><workbook><worksheets>
      <worksheet name='Sheet 1'><table><rows /></table></worksheet>
    </worksheets><windows><window class='worksheet' name='Sheet 1' /></windows></workbook>`;
    const changedWorkbook = previewWorkbook.replace('<rows />', '<cols />');
    const { executor, appliedDocuments } = statefulExecutor(changedWorkbook);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      expectedState: deriveWorksheetApplyState(previewWorkbook, worksheetName, validXml),
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('preview-state-changed');
    }
    expect(appliedDocuments).toHaveLength(0);
  });

  it('refuses before POST when the target worksheet window changed after preview', async () => {
    const previewWorkbook = `<?xml version='1.0'?><workbook><worksheets>
      <worksheet name='Sheet 1'><table /></worksheet>
    </worksheets><windows><window class='worksheet' name='Sheet 1'><cards><card type='filters' /></cards></window></windows></workbook>`;
    const changedWorkbook = previewWorkbook.replace("type='filters'", "type='marks'");
    const intendedWindow =
      "<window class='worksheet' name='Sheet 1'><cards><card type='pages' /></cards></window>";
    const { executor, appliedDocuments } = statefulExecutor(changedWorkbook);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      worksheetWindowXml: intendedWindow,
      expectedState: deriveWorksheetApplyState(
        previewWorkbook,
        worksheetName,
        validXml,
        intendedWindow,
      ),
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    expect(appliedDocuments).toHaveLength(0);
  });

  it('replaces the target when its live state still matches the preview', async () => {
    const initialWorkbook = liveWorkbook([worksheetName]);
    const { executor, appliedDocuments } = statefulExecutor(initialWorkbook);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      expectedState: deriveWorksheetApplyState(initialWorkbook, worksheetName, validXml),
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(appliedDocuments).toHaveLength(1);
    expect(appliedDocuments[0]).toContain('<rows');
  });

  it('applies the exact confirmed worksheet window and cards when live state still matches', async () => {
    const initialWorkbook = liveWorkbook([worksheetName]).replace(
      `<window class='worksheet' name='${worksheetName}' />`,
      `<window class='worksheet' name='${worksheetName}'><cards><old-card /></cards></window>`,
    );
    const intendedWindow = `<window class='worksheet' name='${worksheetName}'><cards><card type='filters' /></cards></window>`;
    const { executor, appliedDocuments } = statefulExecutor(initialWorkbook);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      worksheetWindowXml: intendedWindow,
      expectedState: deriveWorksheetApplyState(
        initialWorkbook,
        worksheetName,
        validXml,
        intendedWindow,
      ),
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(appliedDocuments).toHaveLength(1);
    expect(appliedDocuments[0]).toContain('<card type="filters">');
    expect(appliedDocuments[0]).not.toContain('<old-card>');
  });

  it.each([
    ['changes', '<card type="marks">'],
    ['drops', ''],
  ])(
    'refuses success when Tableau %s the confirmed worksheet cards after POST',
    async (_, card) => {
      const initialWorkbook = liveWorkbook([worksheetName]);
      const intendedWindow = `<window class='worksheet' name='${worksheetName}'><cards><card type='filters' /></cards></window>`;
      let liveWorkbookXml = initialWorkbook;
      const executor = {
        getWorkbookDocument: vi.fn(async () =>
          Ok({
            xml: liveWorkbookXml,
            applicationVersion: undefined,
            xsdPayloadVersion: undefined,
          }),
        ),
        applyWorkbookDocument: vi.fn(async (xml: string) => {
          liveWorkbookXml = xml.replace('<card type="filters">', card);
          return Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' });
        }),
        listWorksheets: vi.fn(async () =>
          Ok({ worksheets: [{ id: 'sheet-1', name: worksheetName }] }),
        ),
        getWorksheetDocument: vi.fn(async () =>
          Ok({ xml: extractSheetXml(liveWorkbookXml, worksheetName) ?? '' }),
        ),
      } as unknown as ToolExecutor;

      const result = await loadWorksheetXml({
        worksheetName,
        xml: validXml,
        worksheetWindowXml: intendedWindow,
        expectedState: deriveWorksheetApplyState(
          initialWorkbook,
          worksheetName,
          validXml,
          intendedWindow,
        ),
        executor,
        signal: mockSignal,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        invariant(result.error.type === 'load-worksheet-xml-error');
        expect(result.error.error).toMatchObject({
          type: 'readback-failed',
          findings: [expect.objectContaining({ kind: 'window' })],
        });
      }
      expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(3);
    },
  );

  it('allows sibling and dashboard edits while guarding only the target worksheet', async () => {
    const previewWorkbook = `<?xml version='1.0'?><workbook>
      <worksheets>
        <worksheet name='Sheet 1'><table /></worksheet>
        <worksheet name='Other'><table><rows /></table></worksheet>
      </worksheets>
      <dashboards><dashboard name='Dashboard 1'><zones /></dashboard></dashboards>
      <windows>
        <window class='worksheet' name='Sheet 1' />
        <window class='worksheet' name='Other' />
      </windows>
    </workbook>`;
    const liveEditedWorkbook = previewWorkbook
      .replace('<rows />', '<cols><column /></cols>')
      .replace('<zones />', '<zones><zone id="new" /></zones>');
    const { executor, appliedDocuments } = statefulExecutor(liveEditedWorkbook);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      expectedState: deriveWorksheetApplyState(previewWorkbook, worksheetName, validXml),
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(appliedDocuments).toHaveLength(1);
    expect(appliedDocuments[0]).toContain('name="Other"');
    expect(appliedDocuments[0]).toContain('<cols>');
    expect(appliedDocuments[0]).toContain('name="Dashboard 1"');
    expect(appliedDocuments[0]).toContain('id="new"');
  });

  it('rebases and preserves an unrelated edit that lands on the pre-POST stability read', async () => {
    const previewWorkbook = `<?xml version='1.0'?><workbook>
      <worksheets>
        <worksheet name='Sheet 1'><table /></worksheet>
        <worksheet name='Other'><table><rows /></table></worksheet>
      </worksheets>
      <windows>
        <window class='worksheet' name='Sheet 1' />
        <window class='worksheet' name='Other' />
      </windows>
    </workbook>`;
    const editedWorkbook = previewWorkbook.replace('<rows />', '<cols><column /></cols>');
    const appliedDocuments: string[] = [];
    const executor = {
      getWorkbookDocument: vi
        .fn()
        .mockResolvedValueOnce(
          Ok({ xml: previewWorkbook, applicationVersion: undefined, xsdPayloadVersion: undefined }),
        )
        .mockResolvedValue(
          Ok({ xml: editedWorkbook, applicationVersion: undefined, xsdPayloadVersion: undefined }),
        ),
      applyWorkbookDocument: vi.fn(async (xml: string) => {
        appliedDocuments.push(xml);
        return Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' });
      }),
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: 'sheet-1', name: worksheetName }] })),
      getWorksheetDocument: vi.fn(async () => Ok({ xml: validXml })),
    } as unknown as ToolExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      expectedState: deriveWorksheetApplyState(previewWorkbook, worksheetName, validXml),
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(3);
    expect(appliedDocuments).toHaveLength(1);
    expect(appliedDocuments[0]).toContain('<cols>');
    expect(appliedDocuments[0]).toContain('<column>');
  });

  it('refuses before POST when the protected target changes on the pre-POST stability read', async () => {
    const previewWorkbook = liveWorkbook([worksheetName]);
    const changedWorkbook = previewWorkbook.replace('<table />', '<table><cols /></table>');
    const appliedDocuments: string[] = [];
    const executor = {
      getWorkbookDocument: vi
        .fn()
        .mockResolvedValueOnce(
          Ok({ xml: previewWorkbook, applicationVersion: undefined, xsdPayloadVersion: undefined }),
        )
        .mockResolvedValue(
          Ok({ xml: changedWorkbook, applicationVersion: undefined, xsdPayloadVersion: undefined }),
        ),
      applyWorkbookDocument: vi.fn(async (xml: string) => {
        appliedDocuments.push(xml);
        return Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' });
      }),
    } as unknown as ToolExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      expectedState: deriveWorksheetApplyState(previewWorkbook, worksheetName, validXml),
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    expect(appliedDocuments).toHaveLength(0);
  });

  it('refuses before POST when unrelated workbook state never stabilizes', async () => {
    const previewWorkbook = `<?xml version='1.0'?><workbook>
      <worksheets>
        <worksheet name='Sheet 1'><table /></worksheet>
        <worksheet name='Other'><table><rows /></table></worksheet>
      </worksheets>
      <windows><window class='worksheet' name='Sheet 1' /><window class='worksheet' name='Other' /></windows>
    </workbook>`;
    let read = 0;
    const appliedDocuments: string[] = [];
    const executor = {
      getWorkbookDocument: vi.fn(async () => {
        const xml = previewWorkbook.replace('<rows />', `<rows><read value='${read++}' /></rows>`);
        return Ok({ xml, applicationVersion: undefined, xsdPayloadVersion: undefined });
      }),
      applyWorkbookDocument: vi.fn(async (xml: string) => {
        appliedDocuments.push(xml);
        return Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' });
      }),
    } as unknown as ToolExecutor;

    const initial = previewWorkbook.replace('<rows />', "<rows><read value='0' /></rows>");
    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      expectedState: deriveWorksheetApplyState(initial, worksheetName, validXml),
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error).toMatchObject({
        type: 'preview-state-changed',
        message: expect.stringMatching(/kept changing.*retry/i),
      });
    }
    expect(appliedDocuments).toHaveLength(0);
  });

  it('refuses before POST when a referenced field definition changed after preview', async () => {
    const incomingXml = `<worksheet name='${worksheetName}'><table><rows>[Orders].[sum:Sales:qk]</rows></table></worksheet>`;
    const previewWorkbook = workbookWithReferencedField('real');
    const liveWorkbookXml = workbookWithReferencedField('integer');
    const { executor, appliedDocuments } = statefulExecutor(liveWorkbookXml);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: incomingXml,
      expectedState: deriveWorksheetApplyState(previewWorkbook, worksheetName, incomingXml),
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error).toMatchObject({
        type: 'preview-state-changed',
        message: expect.stringMatching(/referenced fields changed.*rebuilt.*reconfirmed/i),
      });
    }
    expect(appliedDocuments).toHaveLength(0);
  });

  it('refuses before POST when a referenced field was removed after preview', async () => {
    const incomingXml = `<worksheet name='${worksheetName}'><table><rows>[Orders].[sum:Sales:qk]</rows></table></worksheet>`;
    const previewWorkbook = workbookWithReferencedField('real');
    const liveWorkbookXml = workbookWithReferencedField(undefined);
    const { executor, appliedDocuments } = statefulExecutor(liveWorkbookXml);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: incomingXml,
      expectedState: deriveWorksheetApplyState(previewWorkbook, worksheetName, incomingXml),
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    expect(appliedDocuments).toHaveLength(0);
  });

  it('allows unrelated field, datasource, connection, and value changes', async () => {
    const incomingXml = `<worksheet name='${worksheetName}'><table><rows>[Orders].[sum:Sales:qk]</rows></table></worksheet>`;
    const previewWorkbook = workbookWithReferencedField('real');
    const liveWorkbookXml = workbookWithReferencedField(
      'real',
      "<column name='[Unused]' role='dimension' type='nominal' datatype='date' />",
      "<connection class='sqlserver'><relation name='renamed'><rows><row value='new' /></rows></relation></connection>",
    ).replace(
      "<datasource name='Other'><column name='[Other]' role='dimension' type='nominal' datatype='string' /></datasource>",
      "<datasource name='Other'><column name='[Other]' role='measure' type='quantitative' datatype='integer' /></datasource>",
    );
    const { executor, appliedDocuments } = statefulExecutor(liveWorkbookXml);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: incomingXml,
      expectedState: deriveWorksheetApplyState(previewWorkbook, worksheetName, incomingXml),
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(appliedDocuments).toHaveLength(1);
  });

  it('allows exactly one concurrent same-target apply from the same preview state', async () => {
    const initialWorkbook = liveWorkbook([worksheetName]);
    const incomingXml = `<worksheet name='${worksheetName}'><table><rows /></table></worksheet>`;
    const expectedState = deriveWorksheetApplyState(initialWorkbook, worksheetName, incomingXml);
    const { executor, appliedDocuments } = statefulExecutor(initialWorkbook);

    const [first, second] = await Promise.all([
      loadWorksheetXml({
        worksheetName,
        xml: incomingXml,
        expectedState,
        executor,
        signal: mockSignal,
      }),
      loadWorksheetXml({
        worksheetName,
        xml: incomingXml,
        expectedState,
        executor,
        signal: mockSignal,
      }),
    ]);

    expect(first.isOk()).toBe(true);
    expect(second.isErr()).toBe(true);
    if (second.isErr()) {
      invariant(second.error.type === 'load-worksheet-xml-error');
      expect(second.error.error.type).toBe('preview-state-changed');
    }
    expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(3);
    expect(appliedDocuments).toHaveLength(1);
  });

  it('preserves both concurrent different-target confirmed applies', async () => {
    const secondWorksheetName = 'Sheet 2';
    const initialWorkbook = liveWorkbook([worksheetName, secondWorksheetName]);
    const firstXml = `<worksheet name='${worksheetName}'><table><rows /></table></worksheet>`;
    const secondXml = `<worksheet name='${secondWorksheetName}'><table><cols /></table></worksheet>`;
    let liveWorkbookXml = initialWorkbook;
    const appliedDocuments: string[] = [];
    const executor = {
      getWorkbookDocument: vi.fn(async () =>
        Ok({
          xml: liveWorkbookXml,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
      applyWorkbookDocument: vi.fn(async (xml: string) => {
        appliedDocuments.push(xml);
        liveWorkbookXml = xml;
        return Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' });
      }),
      listWorksheets: vi.fn(async () =>
        Ok({
          worksheets: [
            { id: 'sheet-1', name: worksheetName },
            { id: 'sheet-2', name: secondWorksheetName },
          ],
        }),
      ),
      getWorksheetDocument: vi.fn(async (id: string) => {
        const name = id === 'sheet-1' ? worksheetName : secondWorksheetName;
        return Ok({ xml: extractSheetXml(liveWorkbookXml, name) ?? '' });
      }),
    } as unknown as ToolExecutor;

    const [first, second] = await Promise.all([
      loadWorksheetXml({
        worksheetName,
        xml: firstXml,
        expectedState: deriveWorksheetApplyState(initialWorkbook, worksheetName, firstXml),
        executor,
        signal: mockSignal,
      }),
      loadWorksheetXml({
        worksheetName: secondWorksheetName,
        xml: secondXml,
        expectedState: deriveWorksheetApplyState(initialWorkbook, secondWorksheetName, secondXml),
        executor,
        signal: mockSignal,
      }),
    ]);

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    expect(appliedDocuments).toHaveLength(2);
    expect(extractSheetXml(liveWorkbookXml, worksheetName)).toContain('<rows>');
    expect(extractSheetXml(liveWorkbookXml, secondWorksheetName)).toContain('<cols>');
  });

  function workbookWithReferencedField(
    datatype: string | undefined,
    extraOrdersField = '',
    connection = "<connection class='textscan'><relation name='orders.csv' /></connection>",
  ): string {
    const sales = datatype
      ? `<column name='[Sales]' role='measure' type='quantitative' datatype='${datatype}' />`
      : '';
    return `<?xml version='1.0'?><workbook>
      <datasources>
        <datasource name='Orders'>${sales}${extraOrdersField}${connection}</datasource>
        <datasource name='Other'><column name='[Other]' role='dimension' type='nominal' datatype='string' /></datasource>
      </datasources>
      <worksheets><worksheet name='${worksheetName}'><table /></worksheet></worksheets>
      <windows><window class='worksheet' name='${worksheetName}' /></windows>
    </workbook>`;
  }

  it('continues worksheet apply when both preflight stages contain only telemetry findings', async () => {
    const telemetryIssue = {
      ruleId: 'calc-field-names',
      severity: 'warning' as const,
      message:
        'Non-standard internal name detected (telemetry only): [Parameter 1]. If this field works correctly in Tableau, this warning can be ignored.',
    };
    vi.mocked(validationRegistry.runValidation).mockReturnValue({
      valid: false,
      issues: [telemetryIssue],
    });
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Sheet 1']));

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.filter((call) => call.kind === 'apply')).toHaveLength(1);
    if (result.isOk()) {
      expect(result.value.validationWarnings).toEqual([telemetryIssue]);
    }
  });

  it('rejects a constructed workbook document missing the worksheet window before POST', async () => {
    vi.mocked(validationRegistry.runValidation).mockRestore();
    sheetUpsertMock.upsertSheetIntoWorkbook = () => `<?xml version='1.0'?>
<workbook>
  <worksheets>
    <worksheet name='Sheet 1'><table /></worksheet>
  </worksheets>
  <windows>
    <window><cards /></window>
  </windows>
</workbook>`;
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Some Other Sheet']));

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('validation-failed');
      invariant(result.error.error.type === 'validation-failed');
      expect(result.error.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'worksheet-missing-window',
            severity: 'error',
            message: expect.stringContaining('Sheet 1'),
          }),
        ]),
      );
    }
    expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
  });

  it('should return error when XML is invalid', async () => {
    const result = await loadWorksheetXml({
      worksheetName,
      xml: 'not xml',
      executor: {} as unknown as ToolExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('invalid-xml');
    }
  });

  it('should return error when XML is empty', async () => {
    const result = await loadWorksheetXml({
      worksheetName,
      xml: '',
      executor: {} as unknown as ToolExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('load-worksheet-xml-error');
    }
  });

  it('should return error when validation fails', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: false,
      issues: [{ ruleId: 'test-rule', severity: 'error', message: 'Invalid structure' }],
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: {} as unknown as ToolExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('validation-failed');
    }
  });

  it('should return execute-command-error when the workbook fetch fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Failed', recoverable: false },
    };
    const mockExecutor = {
      getWorkbookDocument: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as ToolExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'execute-command-error');
      expect(result.error.error).toEqual(error);
    }
  });
});
