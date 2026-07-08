import { writeFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';

import * as configModule from '../../../config.desktop.js';
import invariant from '../../../utils/invariant.js';
import * as xmlToJsonModule from '../../libraries/workbook-serialization-converter/index.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import * as validationRegistry from '../../validation/registry.js';
import { loadWorkbookXml, SCRATCH_PREFIX } from './loadWorkbookXml.js';

vi.mock('fs');
vi.mock('../../toolExecutor/localToolExecutor.js');
vi.mock('../../libraries/workbook-serialization-converter/index.js');
vi.mock('../../validation/registry.js');

describe('loadWorkbookXml (Agent API transport, default)', () => {
  const mockSignal = new AbortController().signal;
  const validXml = '<?xml version="1.0"?><workbook><worksheets></worksheets></workbook>';

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for validation - passes
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
  });

  it('should successfully load workbook XML via filepath', async () => {
    const mockJson = '{"workbook": {}}';
    vi.spyOn(xmlToJsonModule, 'xmlToJson').mockReturnValue(mockJson);

    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          submitted_at: '',
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'tabui',
        command: 'load-underlying-metadata',
        args: expect.objectContaining({
          filepath: expect.stringContaining('workbook-apply'),
        }),
      }),
    );
    expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining('.json'), mockJson, 'utf-8');
  });

  it('should fallback to text mode when XML to JSON conversion fails', async () => {
    vi.spyOn(xmlToJsonModule, 'xmlToJson').mockImplementation(() => {
      throw new Error('Conversion failed');
    });

    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          submitted_at: '',
          parsedResult: {
            status: 'completed',
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);

    // Should call with text argument instead
    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          text: validXml,
        }),
      }),
    );
  });

  it('should fallback to text mode when filepath load fails', async () => {
    const mockJson = '{"workbook": {}}';
    vi.spyOn(xmlToJsonModule, 'xmlToJson').mockReturnValue(mockJson);

    const mockExecutor = {
      executeCommand: vi
        .fn()
        .mockResolvedValueOnce(
          Err({
            type: 'command-failed',
            error: { code: 'ERROR', message: 'Failed to load', recoverable: false },
          }),
        )
        .mockResolvedValueOnce(
          Ok({
            command_id: 'cmd-124',
            status: 'completed',
            submitted_at: '',
            parsedResult: {
              status: 'completed',
            },
          }),
        ),
    } as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(mockExecutor.executeCommand).toHaveBeenCalledTimes(2);
    // Second call should be text mode
    expect(mockExecutor.executeCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          text: validXml,
        }),
      }),
    );
  });

  it('should return error when XML is invalid', async () => {
    const invalidXml = 'not xml';

    const mockExecutor = {} as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: invalidXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      expect(result.error.error.type).toBe('invalid-xml');
    }
  });

  it('should return error when XML is empty', async () => {
    const mockExecutor = {} as unknown as LocalExecutor;

    const result = await loadWorkbookXml({ xml: '', executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('load-workbook-xml-error');
    }
  });

  it('should return error when validation fails', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: false,
      issues: [
        {
          ruleId: 'test-rule',
          severity: 'error',
          message: 'Invalid structure',
        },
      ],
    });

    const mockExecutor = {} as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      expect(result.error.error.type).toBe('validation-failed');
    }
  });

  it('should return error when text mode load fails', async () => {
    vi.spyOn(xmlToJsonModule, 'xmlToJson').mockImplementation(() => {
      throw new Error('Conversion failed');
    });

    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Err({
          type: 'command-failed',
          error: { code: 'ERROR', message: 'Failed to load', recoverable: false },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('execute-command-error');
    }
  });

  it('should return error when executeCommand fails', async () => {
    const mockJson = '{"workbook": {}}';
    vi.spyOn(xmlToJsonModule, 'xmlToJson').mockReturnValue(mockJson);

    const error = { type: 'command-timed-out' as const, error: 'Timeout' };
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('execute-command-error');
      expect(result.error.error).toEqual(error);
    }
  });

  it('should use provided filepath when specified', async () => {
    const mockJson = '{"workbook": {}}';
    const customFilePath = '/custom/path/workbook.json';
    vi.spyOn(xmlToJsonModule, 'xmlToJson').mockReturnValue(mockJson);

    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          submitted_at: '',
        }),
      ),
    } as unknown as LocalExecutor;

    await loadWorkbookXml({
      xml: validXml,
      filePath: customFilePath,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(writeFileSync).toHaveBeenCalledWith(customFilePath, mockJson, 'utf-8');
    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          filepath: customFilePath,
        }),
      }),
    );
  });

  it('should trim whitespace from XML', async () => {
    const xmlWithWhitespace = `
      ${validXml}
    `;
    const mockJson = '{"workbook": {}}';
    vi.spyOn(xmlToJsonModule, 'xmlToJson').mockReturnValue(mockJson);

    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          submitted_at: '',
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: xmlWithWhitespace,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(validationRegistry.runValidation).toHaveBeenCalledWith(validXml, 'workbook');
  });

  it('should proceed with warnings but not errors', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: true,
      issues: [
        {
          ruleId: 'test-rule',
          severity: 'warning',
          message: 'Deprecated element',
        },
      ],
    });

    const mockJson = '{"workbook": {}}';
    vi.spyOn(xmlToJsonModule, 'xmlToJson').mockReturnValue(mockJson);

    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          submitted_at: '',
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(mockExecutor.executeCommand).toHaveBeenCalled();
  });
});

describe('loadWorkbookXml (External Client API transport, TABLEAU_EXTERNAL_API gate)', () => {
  const mockSignal = new AbortController().signal;
  const validXml =
    '<?xml version="1.0"?><workbook>' +
    '<worksheets><worksheet name="Sheet 1"><table /></worksheet></worksheets>' +
    '</workbook>';

  // Executor that records every dispatched command so the scratch-reset sequence
  // (save-underlying-metadata fetch → new-worksheet → delete-sheet* → load-underlying-metadata →
  // delete-sheet scratch) is assertable. The fetch returns `liveXml` as the live workbook.
  function dispatchingExecutor(liveXml: string = validXml): {
    executor: LocalExecutor;
    calls: Array<{ namespace: string; command: string; args?: Record<string, unknown> }>;
  } {
    const calls: Array<{ namespace: string; command: string; args?: Record<string, unknown> }> = [];
    const executeCommand = vi.fn(async (params: any) => {
      calls.push({ namespace: params.namespace, command: params.command, args: params.args });
      if (params.command === 'save-underlying-metadata') {
        return Ok({ command_id: 'cmd-get', status: 'completed', parsedResult: { text: liveXml } });
      }
      return Ok({ command_id: 'cmd', status: 'completed', submitted_at: '' });
    });
    return { executor: { executeCommand } as unknown as LocalExecutor, calls };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
    const base = configModule.getDesktopConfig();
    vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
      ...base,
      externalApiEnabled: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resets colliding sheets behind a scratch sheet, then applies via the text POST', async () => {
    const { executor, calls } = dispatchingExecutor();

    const result = await loadWorkbookXml({ xml: validXml, executor, signal: mockSignal });

    expect(result.isOk()).toBe(true);

    const scratchAdd = calls.find((c) => c.command === 'new-worksheet');
    expect(scratchAdd?.namespace).toBe('tabdoc');
    const scratchName = scratchAdd?.args?.NewSheet as string;
    expect(scratchName.startsWith(SCRATCH_PREFIX)).toBe(true);

    // The doc's own sheet is deleted before the POST so the additive merge can re-add it cleanly.
    expect(calls.some((c) => c.command === 'delete-sheet' && c.args?.Sheet === 'Sheet 1')).toBe(
      true,
    );

    // POST happens after the deletes and before the scratch is removed.
    const postIdx = calls.findIndex((c) => c.command === 'load-underlying-metadata');
    const scratchDeleteIdx = calls.findIndex(
      (c) => c.command === 'delete-sheet' && c.args?.Sheet === scratchName,
    );
    expect(postIdx).toBeGreaterThan(0);
    expect(scratchDeleteIdx).toBeGreaterThan(postIdx);
    expect(calls[postIdx].args).toEqual({ text: validXml });
  });

  it('should return error when XML is invalid', async () => {
    const result = await loadWorkbookXml({
      xml: 'not xml',
      executor: {} as unknown as LocalExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      expect(result.error.error.type).toBe('invalid-xml');
    }
  });

  it('should return error when XML is empty', async () => {
    const result = await loadWorkbookXml({
      xml: '',
      executor: {} as unknown as LocalExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('load-workbook-xml-error');
    }
  });

  it('should return error when validation fails', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: false,
      issues: [{ ruleId: 'test-rule', severity: 'error', message: 'Invalid structure' }],
    });

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: {} as unknown as LocalExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      expect(result.error.error.type).toBe('validation-failed');
    }
  });

  it('should return execute-command-error when the apply POST fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'Timeout' };
    const executeCommand = vi.fn(async (params: any) => {
      if (params.command === 'save-underlying-metadata') {
        return Ok({ command_id: 'cmd-get', status: 'completed', parsedResult: { text: validXml } });
      }
      if (params.command === 'load-underlying-metadata') {
        return Err(error);
      }
      return Ok({ command_id: 'cmd', status: 'completed', submitted_at: '' });
    });
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'execute-command-error');
      expect(result.error.error).toEqual(error);
    }
    // The scratch sheet is still cleaned up even after a failed POST.
    const scratchAdd = (executeCommand.mock.calls as any[]).find(
      ([p]) => p.command === 'new-worksheet',
    );
    const scratchName = scratchAdd[0].args.NewSheet;
    expect(
      (executeCommand.mock.calls as any[]).some(
        ([p]) => p.command === 'delete-sheet' && p.args?.Sheet === scratchName,
      ),
    ).toBe(true);
  });

  it('should trim whitespace from XML before validating and applying', async () => {
    const { executor, calls } = dispatchingExecutor();

    const result = await loadWorkbookXml({
      xml: `\n      ${validXml}\n    `,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(validationRegistry.runValidation).toHaveBeenCalledWith(validXml, 'workbook');
    const post = calls.find((c) => c.command === 'load-underlying-metadata');
    expect(post?.args).toEqual({ text: validXml });
  });

  it('should proceed with warnings but not errors', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: true,
      issues: [{ ruleId: 'test-rule', severity: 'warning', message: 'Deprecated element' }],
    });

    const { executor, calls } = dispatchingExecutor();

    const result = await loadWorkbookXml({ xml: validXml, executor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    expect(calls.some((c) => c.command === 'load-underlying-metadata')).toBe(true);
  });
});
