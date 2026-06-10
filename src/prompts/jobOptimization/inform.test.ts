import { WebMcpServer } from '../../server.web.js';
import { getJobOptimizationInformPrompt } from './inform.js';

const textOf = async (args: Record<string, string> = {}): Promise<string> => {
  const prompt = getJobOptimizationInformPrompt(new WebMcpServer());
  const result = await prompt.callback(args);
  expect(result.messages).toHaveLength(1);
  const message = result.messages[0];
  expect(message.role).toBe('user');
  if (message.content.type !== 'text') {
    throw new Error('expected text content');
  }
  return message.content.text;
};

describe('job-optimization-inform prompt', () => {
  it('registers under the documented name', () => {
    const prompt = getJobOptimizationInformPrompt(new WebMcpServer());
    expect(prompt.name).toBe('job-optimization-inform');
  });

  it('is disabled when adminToolsEnabled is false', () => {
    const prompt = getJobOptimizationInformPrompt(new WebMcpServer());
    expect(prompt.disabled({ adminToolsEnabled: true } as any)).toBe(false);
    expect(prompt.disabled({ adminToolsEnabled: false } as any)).toBe(true);
  });

  it('instructs the model to call the tool once and forbid recomputation', async () => {
    const text = await textOf();
    expect(text).toContain('`query-admin-insights-job-performance`');
    expect(text).toContain('exactly once');
    expect(text).toContain('Do **not** recompute');
  });

  it('defaults to the extract refresh job types with no discovery step', async () => {
    const text = await textOf();
    expect(text).toContain('"RefreshExtracts"');
    expect(text).toContain('"RefreshExtractsViaBridge"');
    expect(text).not.toContain('__JOB_TYPE__');
    expect(text).not.toContain('distinct `Job Type`');
  });

  it('scopes to explicit comma-separated job types without discovery', async () => {
    const text = await textOf({ jobType: 'SendSingleSubscription, RunFlow' });
    expect(text).toContain('"SendSingleSubscription"');
    expect(text).toContain('"RunFlow"');
    expect(text).not.toContain('"RefreshExtracts"');
    expect(text).not.toContain('__JOB_TYPE__');
  });

  it('emits a relative-date filter when lookbackDays is provided', async () => {
    const text = await textOf({ lookbackDays: '30' });
    expect(text).toContain('"fieldCaption": "Started At"');
    expect(text).toContain('"dateRangeType": "LASTN"');
    expect(text).toContain('"periodType": "DAYS"');
    expect(text).toContain('"rangeN": 30');
  });

  it('omits the relative-date filter when lookbackDays is absent', async () => {
    const text = await textOf();
    expect(text).not.toContain('LASTN');
    expect(text).not.toContain('"dateRangeType"');
  });

  it('passes limit into the tool args when provided', async () => {
    const text = await textOf({ limit: '100' });
    expect(text).toContain('"limit": 100');
  });

  it('omits limit from the tool args when absent', async () => {
    const text = await textOf();
    expect(text).not.toContain('"limit"');
  });

  it('enters discovery mode when discover is true', async () => {
    const text = await textOf({ discover: 'true' });
    expect(text).toContain('distinct `Job Type`');
    expect(text).toContain('__JOB_TYPE__');
    expect(text).toContain('each discovered');
  });
});
