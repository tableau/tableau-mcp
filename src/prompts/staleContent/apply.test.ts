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
    // Tagging only happens in the post-approval (dryRun:false) branch.
    const text = getText({ dryRun: 'false', tag: 'sunset-2026' });
    expect(text).toContain('sunset-2026');
  });

  it('does not tag anything during a dry run (F1 — no write before approval)', () => {
    const text = getText();
    expect(text).toContain('DRY RUN is active');
    expect(text).toContain('do NOT tag any item');
    // No tagging step is emitted in the dry-run branch.
    expect(text).not.toContain('Tag approved items');
  });

  it('gates tagging behind human approval — tag step follows the HITL break (F1)', () => {
    const text = getText({ dryRun: 'false' });
    const gateIdx = text.indexOf('REQUIRED HUMAN CONFIRMATION');
    const tagIdx = text.indexOf('Tag approved items');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(tagIdx).toBeGreaterThan(-1);
    // The tag step must come after the confirmation gate, never before.
    expect(tagIdx).toBeGreaterThan(gateIdx);
    expect(text).toContain('ONLY for the items the user explicitly approved');
  });

  it('refuses to act on an oversized report and asks to narrow scope (F1)', () => {
    const text = getText();
    expect(text).toContain('more than 100 rows');
    expect(text).toContain('narrow the scope');
  });

  it('errors instead of silently widening when itemTypes has zero supported types', () => {
    const text = getText({ itemTypes: 'Flow' });
    expect(text).toContain('No supported content types in itemTypes: Flow');
    expect(text).toContain('Workbook, Datasource');
    // Must NOT fall through to running the full workflow on all types.
    expect(text).not.toContain('get-stale-content-report');
  });

  it('surfaces dropped unsupported itemTypes alongside supported ones', () => {
    const text = getText({ itemTypes: 'Workbook, Flow' });
    expect(text).toContain('ignoring unsupported itemTypes');
    expect(text).toContain('Flow');
    expect(text).toContain('delete-workbook');
    // Still runs the workflow for the supported subset.
    expect(text).toContain('get-stale-content-report');
    expect(text).not.toContain('delete-datasource');
  });

  it('de-duplicates repeated itemTypes (single routing/confirm block)', () => {
    const text = getText({ dryRun: 'false', itemTypes: 'Workbook,Workbook,Datasource' });
    const routing = JSON.parse(text.split('```json')[1].split('```')[0]);
    expect(routing).toHaveLength(2);
    expect(routing.map((r: { itemType: string }) => r.itemType)).toEqual(['Workbook', 'Datasource']);
  });

  it('renders a single confirm-instruction block referencing the routing table', () => {
    const text = getText({ dryRun: 'false' });
    expect(text).toContain('the routing table maps');
    // Only one confirm block, regardless of how many delete tools are in scope.
    expect(text.match(/Only AFTER the user approves/g)).toHaveLength(1);
  });
});
