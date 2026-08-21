import { clearKnowledgeCache, listKnowledgeResources, readKnowledgeResource } from './index.js';

describe('desktop knowledge resources', () => {
  beforeEach(() => {
    clearKnowledgeCache();
  });

  it('ships at least 100 knowledge resources', () => {
    expect(listKnowledgeResources().length).toBeGreaterThanOrEqual(100);
  });

  it('surfaces the bulk UI translation entry for workbook translation prompts', () => {
    const resource = listKnowledgeResources().find(
      (entry) => entry.uri === 'expertise://tableau/tactics/workflow/ui-translation-bulk-text-edit',
    );

    expect(resource?.name).toBe('Bulk UI Translation of a Workbook (Three-Layer Text Model)');

    const content = readKnowledgeResource(resource!.uri);
    expect(content).toContain('three layers');
    expect(content).toContain('<customized-label>');
    expect(content).toContain('<customized-tooltip>');
    expect(content).toContain('<column caption="...">');
    expect(content).toContain('workbook-wide field RENAME');
    expect(content).toContain('exact-tag replacement');
    expect(content).toContain('get-worksheet-xml');
    expect(content).toContain('apply-worksheet');
  });

  it('surfaces the failure-recovery-honesty entry (stale-cache re-read + receipt honesty)', () => {
    const resource = listKnowledgeResources().find(
      (entry) => entry.uri === 'expertise://tableau/tactics/workflow/failure-recovery-honesty',
    );

    expect(resource?.name).toBe(
      'Recovering From "Not Found" and Honoring the Verification Receipt',
    );
    expect(resource?.description).toContain('stale cache');

    const content = readKnowledgeResource(resource!.uri);
    // Rule 8 — stale-cache re-read before declaring Tableau unreachable
    expect(content).toContain('stale cache');
    expect(content).toContain('get-workbook-xml');
    expect(content).toContain('list-available-fields');
    expect(content).toContain('resolve-field');
    expect(content).toContain('not_found');
    // Rule 9 — honor the host verification receipt
    expect(content).toContain('HOST VERIFICATION');
    expect(content).toContain('verified');
    expect(content).toContain('unverified');
    expect(content).toContain('run-dashboard-batch');
    expect(content).toContain('structural verification');
    expect(content).toContain('partial');
    expect(content).toContain('unknown');
    expect(content).toContain('never replay');
    expect(content).not.toContain('dashboard-auto-apply');
  });

  it('teaches the current dashboard batch path in template guidance', () => {
    const content = readKnowledgeResource('expertise://tableau/tactics/workflow/templates');

    expect(content).toContain('artifactIds');
    expect(content).toContain('run-dashboard-batch');
    expect(content).toContain('compose-dashboard');
    expect(content).not.toContain('dashboard-auto-apply');
  });

  it('teaches one chart-route precedence without unavailable apply paths', () => {
    const content = readKnowledgeResource('expertise://tableau/tactics/workflow/templates');

    expect(content).toContain('Preview/no-change');
    expect(content).toContain('open multi-chart');
    expect(content).toContain('skip `bind-template`');
    expect(content).toContain('Recognizable single-view visualization');
    expect(content).toContain('semantic ask may return one bounded proposal');
    expect(content).toContain('existing-sheet tools only');
    expect(content).toContain('Unnamed derived metric');
    expect(content).not.toMatch(/build-and-apply-worksheet|inject-template|apply-workbook/);
  });

  it('surfaces the Tableau vocabulary entry for user-facing narration prompts', () => {
    const resource = listKnowledgeResources().find(
      (entry) => entry.uri === 'expertise://tableau/tactics/workflow/tableau-vocabulary',
    );

    expect(resource?.name).toBe('Tableau Vocabulary for User-Facing Narration');
    expect(resource?.description).toContain('Tableau users should hear product vocabulary');

    const content = readKnowledgeResource(resource!.uri);
    expect(content).toContain('never say XML');
    expect(content).toContain('Columns');
    expect(content).toContain('Rows');
    expect(content).toContain('Number (whole)');
    expect(content).toContain('True/False');
  });

  it('teaches binder-first explicit charts with a guarded artifact fallback', () => {
    const uri = 'expertise://tableau/personalization/discovery-first-authoring';
    const content = readKnowledgeResource(uri);

    expect(content).toContain('`list-templates`');
    expect(content).toContain('`bind-template`');
    expect(content).toContain('`auto_apply:true`');
    expect(content).toContain('one exact `call_2_contract` proposal');
    expect(content).toContain(
      '`applied:true` plus clean host verification, or a verified fallback `apply-worksheet` receipt',
    );
    expect(content).toContain(
      'If that second call still proposes, or any result escalates or blocks',
    );
    expect(content).toContain('`build-worksheets-from-templates`');
    expect(content).toContain('`apply-worksheet`');
    expect(content).toContain('`get-worksheet-xml` is available before or after authoring');
    expect(content).not.toContain('after an authoring attempt');
    expect(content).not.toMatch(/get-worksheet-xml.{0,80}(?:unlock|after an authoring attempt)/i);
    expect(content).not.toMatch(/(?:redirect|gate).{0,80}bind-template/i);
  });
});
