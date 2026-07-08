import { Err, Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import * as validationRegistry from '../../validation/registry.js';
import { loadWorksheetXml } from './loadWorksheetXml.js';

vi.mock('../../toolExecutor/localToolExecutor.js');
vi.mock('../../validation/registry.js');

describe('loadWorksheetXml', () => {
  const mockSignal = new AbortController().signal;
  const worksheetName = 'Sheet 1';
  const validXml = '<worksheet name="Sheet 1"><table></table></worksheet>';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
  });

  it('should successfully load worksheet XML', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          submitted_at: '',
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'tabui',
        command: 'load-worksheet',
        args: {
          worksheetName,
          worksheetXml: validXml,
        },
      }),
    );
  });

  it('should return error when XML is invalid', async () => {
    const mockExecutor = {} as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: 'not xml',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('invalid-xml');
    }
  });

  it('should return error when XML is empty', async () => {
    const mockExecutor = {} as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: '',
      executor: mockExecutor,
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

    const mockExecutor = {} as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('validation-failed');
    }
  });

  it('should proceed with warnings but not errors', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: true,
      issues: [{ ruleId: 'test-rule', severity: 'warning', message: 'Deprecated element' }],
    });

    const mockExecutor = {
      executeCommand: vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-123', status: 'completed', submitted_at: '' })),
    } as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(mockExecutor.executeCommand).toHaveBeenCalled();
  });

  it('should return error when executeCommand fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Failed', recoverable: false },
    };
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
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

  it('should trim whitespace from XML', async () => {
    const xmlWithWhitespace = `\n  ${validXml}\n`;
    const mockExecutor = {
      executeCommand: vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-123', status: 'completed', submitted_at: '' })),
    } as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: xmlWithWhitespace,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(validationRegistry.runValidation).toHaveBeenCalledWith(validXml, 'worksheet');
  });

  it('reports load-rejected when the command completes but Desktop rejected the load', async () => {
    // Mirrors the workbook path: the command reports status:'completed' while the
    // document load itself failed — the failure lives in the result payload.
    const deskError =
      'The load was not able to complete successfully. Qualified Name Parse Error --- ' +
      'Invalid input: mismatched brackets --- Input: [Sample - Superstore].[[Sub-Category]]';
    const executeCommand = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-1',
        status: 'completed',
        submitted_at: '',
        result: { success: false, error: { message: deskError } },
      }),
    );
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      invariant(result.error.error.type === 'load-rejected');
      expect(result.error.error.message).toContain('Qualified Name Parse Error');
    }
  });

  it('reports load-rejected when the command status carries a top-level error object', async () => {
    const executeCommand = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-2',
        status: 'completed',
        submitted_at: '',
        error: {
          code: 'LOAD_FAILED',
          message: 'worksheet could not be loaded',
          recoverable: false,
        },
      }),
    );
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      invariant(result.error.error.type === 'load-rejected');
      expect(result.error.error.message).toContain('worksheet could not be loaded');
    }
  });
});
