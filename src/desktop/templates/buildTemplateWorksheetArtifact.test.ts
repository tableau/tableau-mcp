import { buildTemplateWorksheetArtifact } from './buildTemplateWorksheetArtifact.js';
import * as injectCore from './injectTemplateCore.js';

const WORKBOOK = `<workbook><datasources>
  <datasource name='federated.actual' caption='Superstore'>
    <column name='[Category]' datatype='string' role='dimension' type='nominal' />
    <column name='[Sales]' datatype='real' role='measure' type='quantitative' />
  </datasource>
</datasources><worksheets/><windows/></workbook>`;

const plan = {
  templateName: 'magnitude-simple-bar',
  title: 'Sales by Category',
  datasource: 'federated.actual',
  fieldMapping: {
    field_base_1: '[federated.actual].[none:Category:nk]',
    field_base_2: '[federated.actual].[sum:Sales:qk]',
  },
};

describe('buildTemplateWorksheetArtifact error classes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports an inject throw as a validation error that keeps its message', () => {
    vi.spyOn(injectCore, 'buildInjectedWorkbookXml').mockImplementation(() => {
      throw new Error('Template binding is incomplete: field_base_2');
    });

    const result = buildTemplateWorksheetArtifact({
      artifactId: 'a1',
      sessionId: 's1',
      instanceId: 'i1',
      workbookXml: WORKBOOK,
      plan,
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.type).toBe('args-validation');
    expect(result.error.message).toContain('Template binding is incomplete: field_base_2');
    expect(result.error.message).not.toContain('Failed to read file');
  });
});
