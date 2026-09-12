import {
  EXTERNAL_API_ROUTES,
  workbookDatasourceDocumentRoute,
  workbookDatasourceRoute,
} from './types.js';

describe('workbook datasource routes', () => {
  it('declares the individual datasource route templates', () => {
    expect(EXTERNAL_API_ROUTES.workbookDatasource).toBe('/v0/workbook/datasources/{id}');
    expect(EXTERNAL_API_ROUTES.workbookDatasourceDocument).toBe(
      '/v0/workbook/datasources/{id}/document',
    );
  });

  it.each([
    ['Sales%20Extract', 'Sales%20Extract'],
    ['Sales%2FExtract', 'Sales%2FExtract'],
    ['Sales%252FExtract', 'Sales%252FExtract'],
  ])('canonicalizes encoded inventory id %s exactly once', (datasourceId, segment) => {
    expect(workbookDatasourceRoute(datasourceId)).toBe(`/v0/workbook/datasources/${segment}`);
    expect(workbookDatasourceDocumentRoute(datasourceId)).toBe(
      `/v0/workbook/datasources/${segment}/document`,
    );
  });
});
