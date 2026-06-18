import { WebMcpServer } from '../../server.web.js';
import { getStaleContentCleanupApplyPrompt } from './apply.js';

function getText(args: Record<string, string> = {}): string {
  const prompt = getStaleContentCleanupApplyPrompt(new WebMcpServer());
  const result = prompt.callback(args as any);
  const resolved = result instanceof Promise ? undefined : result;
  if (!resolved) {
    throw new Error('apply prompt callback is expected to be synchronous');
  }
  const message = resolved.messages[0];
  if (message.content.type !== 'text') {
    throw new Error('expected text content');
  }
  return message.content.text;
}

describe('stale-content-cleanup-apply prompt', () => {
  it('registers under the documented name', () => {
    const prompt = getStaleContentCleanupApplyPrompt(new WebMcpServer());
    expect(prompt.name).toBe('stale-content-cleanup-apply');
  });

  it('is disabled when adminToolsEnabled is false', () => {
    const prompt = getStaleContentCleanupApplyPrompt(new WebMcpServer());
    expect(prompt.disabled({ adminToolsEnabled: true } as any)).toBe(false);
    expect(prompt.disabled({ adminToolsEnabled: false } as any)).toBe(true);
  });

  it('drives the report tool once and forbids recomputation', () => {
    const text = getText();
    expect(text).toContain('`get-stale-content-report`');
    expect(text).toContain('exactly once');
    expect(text).toContain('do **not** recompute `daysSinceLastUse`');
  });

  it('routes both supported content types to their list and delete tools', () => {
    const text = getText();
    expect(text).toContain('list-workbooks');
    expect(text).toContain('delete-workbook');
    expect(text).toContain('list-datasources');
    expect(text).toContain('delete-datasource');
  });

  it('explains the itemId→LUID bridge via list-* name/project filter', () => {
    const text = getText();
    expect(text).toContain('numeric `itemId`');
    expect(text).toContain('name:eq:<itemName>,projectName:eq:<project>');
    expect(text).toContain('DO NOT guess');
  });

  it('includes the required HITL gate before any delete', () => {
    const text = getText();
    expect(text).toContain('REQUIRED HUMAN CONFIRMATION');
  });

  it('resolves missing owner emails via list-users and is report-only', () => {
    const text = getText();
    expect(text).toContain('list-users');
    expect(text).toContain('id:in:');
    expect(text).toContain('report-only');
  });

  it('defaults to dry run — stops before the confirmed-delete phase', () => {
    const text = getText();
    expect(text).toContain('DRY RUN is active');
    // The dry-run branch omits the Grace check / confirmed-delete steps entirely.
    expect(text).not.toContain('Grace check');
    expect(text).not.toContain('Step 7 — Delete (confirmed)');
  });

  it('emits the confirmed-delete phase when dryRun is false', () => {
    const text = getText({ dryRun: 'false' });
    expect(text).toContain('Grace check');
    expect(text).toContain('`confirm: true`');
    expect(text).toContain('recycle bin');
  });

  it('passes minAgeDays and projectIds through to the report args', () => {
    const text = getText({ minAgeDays: '30', projectIds: 'p-1, p-2' });
    expect(text).toContain('"minAgeDays": 30');
    expect(text).toContain('p-1');
    expect(text).toContain('p-2');
  });

  it('uses the server default threshold when minAgeDays is omitted', () => {
    const text = getText();
    expect(text).toContain('"minAgeDays": 90');
  });

  it('scopes routing to the requested itemTypes only', () => {
    const text = getText({ itemTypes: 'Workbook' });
    expect(text).toContain('delete-workbook');
    expect(text).not.toContain('delete-datasource');
  });

  it('applies a custom pending-deletion tag', () => {
    const text = getText({ tag: 'sunset-2026' });
    expect(text).toContain('sunset-2026');
  });
});
