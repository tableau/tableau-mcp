import { writeFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import * as xmlToJsonModule from '../../libraries/workbook-serialization-converter/index.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import * as validationRegistry from '../../validation/registry.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';

vi.mock('fs');
vi.mock('../../toolExecutor/localToolExecutor.js');
vi.mock('../../libraries/workbook-serialization-converter/index.js');
vi.mock('../../validation/registry.js');

describe('loadWorkbookXml', () => {
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
