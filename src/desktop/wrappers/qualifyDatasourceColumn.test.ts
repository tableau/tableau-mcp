import { qualifyDatasourceColumn } from './qualifyDatasourceColumn.js';

const datasource = { caption: 'Sample - Superstore', internalName: 'federated.0abc123' };

describe('qualifyDatasourceColumn', () => {
  it.each(['0.2.25', '0.2.26', '0.3.0', '1.0.0'])(
    'qualifies with the internal name on API version %s',
    (apiVersion) => {
      expect(qualifyDatasourceColumn(apiVersion, datasource, 'Sales')).toBe(
        '[federated.0abc123].[Sales]',
      );
    },
  );

  it.each(['0.2.24', '0.2.20', '0.1.9'])(
    'qualifies with the caption on API version %s',
    (apiVersion) => {
      expect(qualifyDatasourceColumn(apiVersion, datasource, 'Sales')).toBe(
        '[Sample - Superstore].[Sales]',
      );
    },
  );

  it('qualifies with the caption when the API version is unknown', () => {
    expect(qualifyDatasourceColumn(undefined, datasource, 'Sales')).toBe(
      '[Sample - Superstore].[Sales]',
    );
  });

  it('strips brackets from an already-bracketed column', () => {
    expect(qualifyDatasourceColumn('0.2.25', datasource, '[Sales]')).toBe(
      '[federated.0abc123].[Sales]',
    );
  });

  it('keeps brackets that are not a surrounding pair', () => {
    expect(qualifyDatasourceColumn('0.2.25', datasource, 'Sales [USD]')).toBe(
      '[federated.0abc123].[Sales [USD]]',
    );
  });
});
