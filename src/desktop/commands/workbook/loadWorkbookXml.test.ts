import { writeFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';

import * as configModule from '../../../config.desktop.js';
import invariant from '../../../utils/invariant.js';
import * as xmlToJsonModule from '../../libraries/workbook-serialization-converter/index.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import * as validationRegistry from '../../validation/registry.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';

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

  it('reports load-rejected when the filepath command completes but Desktop rejected the load', async () => {
    // The false-success shape from Bug 1's root cause: the Agent API reports the
    // COMMAND completed (status: 'completed') while the document load itself failed —
    // the load outcome is carried in the result payload, not in status.
    const mockJson = '{"workbook": {}}';
    vi.spyOn(xmlToJsonModule, 'xmlToJson').mockReturnValue(mockJson);

    const deskError =
      'The load was not able to complete successfully. Qualified Name Parse Error --- ' +
      'Invalid input: mismatched brackets --- Input: [Sample - Superstore].[[Sub-Category]]';

    const executeCommand = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-123',
        status: 'completed',
        submitted_at: '',
        result: { success: false, error: { message: deskError } },
      }),
    );
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      invariant(result.error.error.type === 'load-rejected');
      expect(result.error.error.message).toContain('Qualified Name Parse Error');
    }
    // A genuine content rejection must NOT be retried via the text path.
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });

  it('reports load-rejected when the text command completes but result carries an error', async () => {
    // Force the text path (JSON conversion fails), then the command "completes" but
    // the result payload signals a failed load.
    vi.spyOn(xmlToJsonModule, 'xmlToJson').mockImplementation(() => {
      throw new Error('Conversion failed');
    });

    const executeCommand = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-124',
        status: 'completed',
        submitted_at: '',
        result: { status: 'failed', message: 'Qualified Name Parse Error: mismatched brackets' },
      }),
    );
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      invariant(result.error.error.type === 'load-rejected');
      expect(result.error.error.message).toContain('Qualified Name Parse Error');
    }
  });

  it('reports load-rejected when the command status carries a top-level error object', async () => {
    const mockJson = '{"workbook": {}}';
    vi.spyOn(xmlToJsonModule, 'xmlToJson').mockReturnValue(mockJson);

    const executeCommand = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-125',
        status: 'completed',
        submitted_at: '',
        error: { code: 'LOAD_FAILED', message: 'workbook could not be loaded', recoverable: false },
      }),
    );
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      invariant(result.error.error.type === 'load-rejected');
      expect(result.error.error.message).toContain('workbook could not be loaded');
    }
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

  // Executor that records every dispatched command so the External API apply is assertable.
  function dispatchingExecutor(): {
    executor: LocalExecutor;
    calls: Array<{ namespace: string; command: string; args?: Record<string, unknown> }>;
  } {
    const calls: Array<{ namespace: string; command: string; args?: Record<string, unknown> }> = [];
    const executeCommand = vi.fn(async (params: any) => {
      calls.push({ namespace: params.namespace, command: params.command, args: params.args });
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

  it('applies via a single whole-document POST without live-workbook pruning', async () => {
    const { executor, calls } = dispatchingExecutor();

    const result = await loadWorkbookXml({ xml: validXml, executor, signal: mockSignal });

    expect(result.isOk()).toBe(true);

    expect(calls.find((c) => c.command === 'save-underlying-metadata')).toBeUndefined();
    expect(calls.find((c) => c.command === 'delete-sheet')).toBeUndefined();

    const posts = calls.filter((c) => c.command === 'load-underlying-metadata');
    expect(posts).toHaveLength(1);
    expect(posts[0].namespace).toBe('tabui');
    expect(posts[0].args).toEqual({ text: validXml });
  });

  it('does not attempt pruning when the whole-document POST fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'Timeout' };
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const executeCommand = vi.fn(async (params: any) => {
      calls.push({ command: params.command, args: params.args });
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
    expect(calls.map((c) => c.command)).toEqual(['load-underlying-metadata']);
    expect(calls.find((c) => c.command === 'delete-sheet')).toBeUndefined();
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
    expect(executeCommand).toHaveBeenCalledTimes(1);
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
