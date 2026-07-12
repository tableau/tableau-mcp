import { clearKnowledgeCache, listKnowledgeResources, readKnowledgeResource } from './index.js';

describe('desktop knowledge resources', () => {
  beforeEach(() => {
    clearKnowledgeCache();
  });

  it('surfaces the bulk UI translation entry for workbook translation prompts', () => {
    const query = 'translate the workbook into German';
    const resource = listKnowledgeResources().find((entry) =>
      [entry.name, entry.description].some((text) =>
        text.toLowerCase().includes(query.toLowerCase()),
      ),
    );

    expect(resource?.uri).toBe('expertise://tableau/tableau-tactics/workflow/bulk-ui-translation');

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
});
