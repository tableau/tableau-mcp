import { Err, Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
import * as validationRegistry from '../../validation/registry.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';

vi.mock('../../validation/registry.js');

describe('loadWorkbookXml (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  const validXml =
    '<?xml version="1.0"?><workbook>' +
    '<worksheets><worksheet name="Sheet 1"><table /></worksheet></worksheets>' +
    '</workbook>';

  // Executor that records every dispatched command so the External API apply is assertable.
  function dispatchingExecutor(): {
    executor: ToolExecutor;
    calls: Array<{ namespace: string; command: string; args?: Record<string, unknown> }>;
  } {
    const calls: Array<{ namespace: string; command: string; args?: Record<string, unknown> }> = [];
    const executeCommand = vi.fn(async (params: any) => {
      calls.push({ namespace: params.namespace, command: params.command, args: params.args });
      return Ok({ command_id: 'cmd', status: 'completed', submitted_at: '' });
    });
    return { executor: { executeCommand } as unknown as ToolExecutor, calls };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
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
    const mockExecutor = { executeCommand } as unknown as ToolExecutor;

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
      executor: {} as unknown as ToolExecutor,
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
      executor: {} as unknown as ToolExecutor,
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
      executor: {} as unknown as ToolExecutor,
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
    const mockExecutor = { executeCommand } as unknown as ToolExecutor;

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
