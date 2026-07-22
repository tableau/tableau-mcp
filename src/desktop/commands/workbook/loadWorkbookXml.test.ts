import { Err, Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
import * as validationRegistry from '../../validation/registry.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';

vi.mock('../../validation/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../validation/registry.js')>();
  return { ...actual, runValidation: vi.fn() };
});

describe('loadWorkbookXml (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  const validXml =
    '<?xml version="1.0"?><workbook>' +
    '<worksheets><worksheet name="Sheet 1"><table /></worksheet></worksheets>' +
    '</workbook>';

  // Executor that records workbook document applies so the External API path is assertable.
  function dispatchingExecutor(): {
    executor: ToolExecutor;
    appliedXml: string[];
  } {
    const appliedXml: string[] = [];
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      appliedXml.push(xml);
      return Ok({ command_id: 'cmd', status: 'completed', submitted_at: '' });
    });
    return { executor: { applyWorkbookDocument } as unknown as ToolExecutor, appliedXml };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies via a single whole-document POST without live-workbook pruning', async () => {
    const { executor, appliedXml } = dispatchingExecutor();

    const result = await loadWorkbookXml({ xml: validXml, executor, signal: mockSignal });

    expect(result.isOk()).toBe(true);

    expect(appliedXml).toEqual([validXml]);
  });

  it('does not attempt pruning when the whole-document POST fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'Timeout' };
    const appliedXml: string[] = [];
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      appliedXml.push(xml);
      return Err(error);
    });
    const mockExecutor = { applyWorkbookDocument } as unknown as ToolExecutor;

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
    expect(appliedXml).toEqual([validXml]);
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
    const applyWorkbookDocument = vi.fn().mockResolvedValue(Err(error));
    const mockExecutor = { applyWorkbookDocument } as unknown as ToolExecutor;

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
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('should trim whitespace from XML before validating and applying', async () => {
    const { executor, appliedXml } = dispatchingExecutor();

    const result = await loadWorkbookXml({
      xml: `\n      ${validXml}\n    `,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(validationRegistry.runValidation).toHaveBeenCalledWith(validXml, 'workbook');
    expect(appliedXml).toEqual([validXml]);
  });

  it('should proceed with warnings but not errors', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: true,
      issues: [{ ruleId: 'test-rule', severity: 'warning', message: 'Deprecated element' }],
    });

    const { executor, appliedXml } = dispatchingExecutor();

    const result = await loadWorkbookXml({ xml: validXml, executor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    expect(appliedXml).toEqual([validXml]);
  });

  it('Miller World Cup repro: telemetry-only parameter findings never block auto-apply', async () => {
    const telemetryIssues = [
      {
        ruleId: 'calc-field-names',
        severity: 'warning' as const,
        message:
          'Non-standard internal name detected (telemetry only): [Parameter 1]. If this field works correctly in Tableau, this warning can be ignored.',
      },
      {
        ruleId: 'calc-field-names',
        severity: 'info' as const,
        message:
          'Non-standard internal name detected (telemetry only): [Parameter 2]. If this field works correctly in Tableau, this warning can be ignored.',
      },
    ];
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      // Reproduce the inconsistent aggregate observed by the live apply boundary:
      // issue severity remains authoritative for deciding whether apply is safe.
      valid: false,
      issues: telemetryIssues,
    });
    const { executor, appliedXml } = dispatchingExecutor();

    const result = await loadWorkbookXml({ xml: validXml, executor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    expect(appliedXml).toEqual([validXml]);
    if (result.isOk()) {
      expect(result.value.validationWarnings).toEqual(telemetryIssues);
    }
  });

  it('returns only real blocking errors when warnings accompany a failed preflight', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: false,
      issues: [
        {
          ruleId: 'calc-field-names',
          severity: 'warning',
          message: 'Non-standard internal name detected (telemetry only): [Parameter 1].',
        },
        {
          ruleId: 'worksheet-missing-window',
          severity: 'error',
          message: 'Worksheet "Sheet 1" has no matching window.',
        },
      ],
    });

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: {} as unknown as ToolExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      invariant(result.error.error.type === 'validation-failed');
      expect(result.error.error.issues).toEqual([
        expect.objectContaining({
          ruleId: 'worksheet-missing-window',
          severity: 'error',
        }),
      ]);
    }
  });
});
