import { qualifyDatasourceColumn } from './qualifyDatasourceColumn.js';

describe('qualifyDatasourceColumn', () => {
  it('qualifies with the datasource internal name', () => {
    expect(qualifyDatasourceColumn('federated.0abc123', 'Sales')).toBe(
      '[federated.0abc123].[Sales]',
    );
  });

  it('strips brackets from an already-bracketed column', () => {
    expect(qualifyDatasourceColumn('federated.0abc123', '[Sales]')).toBe(
      '[federated.0abc123].[Sales]',
    );
  });

  it('keeps brackets that are not a surrounding pair', () => {
    expect(qualifyDatasourceColumn('federated.0abc123', 'Sales [USD]')).toBe(
      '[federated.0abc123].[Sales [USD]]',
    );
  });
});
