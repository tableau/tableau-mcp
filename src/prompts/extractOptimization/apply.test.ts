import { WebMcpServer } from '../../server.web.js';
import { getExtractOptimizationApplyPrompt } from './apply.js';

const textOf = async (args: Record<string, string> = {}): Promise<string> => {
  const prompt = getExtractOptimizationApplyPrompt(new WebMcpServer());
  const result = await prompt.callback(args);
  expect(result.messages).toHaveLength(1);
  const message = result.messages[0];
  expect(message.role).toBe('user');
  if (message.content.type !== 'text') {
    throw new Error('expected text content');
  }
  return message.content.text;
};

describe('extract-optimization-apply prompt', () => {
  it('registers under the documented name', () => {
    const prompt = getExtractOptimizationApplyPrompt(new WebMcpServer());
    expect(prompt.name).toBe('extract-optimization-apply');
  });

  it('is disabled when adminToolsEnabled is false', () => {
    const prompt = getExtractOptimizationApplyPrompt(new WebMcpServer());
    expect(prompt.disabled({ adminToolsEnabled: true } as any)).toBe(false);
    expect(prompt.disabled({ adminToolsEnabled: false } as any)).toBe(true);
  });

  it('orchestrates the four expected tools', async () => {
    const text = await textOf();
    expect(text).toContain('`list-extract-refresh-tasks`');
    expect(text).toContain('`query-admin-insights-job-performance`');
    expect(text).toContain('`update-cloud-extract-refresh-task`');
    expect(text).toContain('`delete-extract-refresh-task`');
  });

  it('marks itself DESTRUCTIVE and locks Steps 1-3 to read-only', async () => {
    const text = await textOf();
    expect(text).toContain('DESTRUCTIVE admin workflow');
    expect(text).toContain('CRITICAL: Steps 1-3 are READ-ONLY');
    expect(text).toContain('Step 1 — Inventory (read-only).');
    expect(text).toContain('Step 2 — Performance signals (read-only).');
    expect(text).toContain('Step 3 — Recommend (read-only).');
  });

  it('defaults to dryRun = true and forbids any PUT or DELETE', async () => {
    const text = await textOf();
    expect(text).toContain('`dryRun = true`');
    expect(text).toContain('Do **not** call `update-cloud-extract-refresh-task`');
    expect(text).toContain('Dry run — no changes applied.');
    // Numbering should not jump 4 → 6 in dry-run; there is no Step 5 (Apply).
    expect(text).toContain('Step 5 — Final report.');
    expect(text).not.toContain('Step 6 — Final report.');
  });

  it('allows the apply step only after Step 4 confirmation when dryRun = false', async () => {
    const text = await textOf({ dryRun: 'false' });
    expect(text).toContain('`dryRun = false`');
    expect(text).toContain('only after** the human confirms in Step 4');
    expect(text).toContain('Step 5 — Apply (only after Step 4 approval).');
    expect(text).toContain('Do **not** parallelize');
    expect(text).toContain('stop immediately');
    expect(text).not.toContain('Dry run — no changes applied.');
    expect(text).toContain('Step 6 — Final report.');
  });

  it('includes the human-in-the-loop confirmation gate', async () => {
    const text = await textOf();
    expect(text).toContain('**Step 4 — Human confirmation break.**');
    expect(text).toContain('🛑 STOP — REQUIRED HUMAN CONFIRMATION before any update or deletion.');
    expect(text).toContain('Reply `yes` to proceed');
    expect(text).toContain('A previous approval does NOT carry forward.');
  });

  it('closes with a Fixed notes safety block', async () => {
    const text = await textOf();
    expect(text).toContain('**Fixed notes**');
    expect(text).toContain(
      '`delete-extract-refresh-task` is irreversible; `update-cloud-extract-refresh-task` is reversible',
    );
    expect(text).toContain('No task is updated or deleted until the user approves');
  });

  it('defaults the scope to every task and omits the Missing tasks section', async () => {
    const text = await textOf();
    expect(text).toContain('every task returned by the inventory step');
    expect(text).not.toContain('Missing tasks');
  });

  it('narrows the scope and adds a Missing tasks bullet when taskIds is provided', async () => {
    const text = await textOf({
      taskIds: '11111111-1111-1111-1111-111111111111, 22222222-2222-2222-2222-222222222222',
    });
    expect(text).toContain('`11111111-1111-1111-1111-111111111111`');
    expect(text).toContain('`22222222-2222-2222-2222-222222222222`');
    expect(text).toContain('narrow the working set client-side');
    expect(text).toContain('Missing tasks');
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
    expect(text).not.toContain('"dateRangeType"');
    expect(text).not.toContain('LASTN');
  });

  it('filters the performance read to extract refresh job types', async () => {
    const text = await textOf();
    expect(text).toContain('"RefreshExtracts"');
    expect(text).toContain('"IncrementExtracts"');
    expect(text).toContain('"RefreshExtractsViaBridge"');
    expect(text).toContain('"IncrementExtractsViaBridge"');
  });
});
