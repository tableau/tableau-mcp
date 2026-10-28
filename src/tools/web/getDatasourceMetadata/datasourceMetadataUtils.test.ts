import { GraphQLResponse } from '../../../sdks/tableau/apis/metadataApi.js';
import { MetadataResponse } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { combineFields, simplifyReadMetadataResult } from './datasourceMetadataUtils.js';

it('preserves display captions, internal names and table scope in both metadata paths', () => {
  const metadata: MetadataResponse = {
    data: [
      { fieldCaption: 'Month', fieldName: 'Month (HEADCOUNT)', logicalTableId: 'headcount' },
      { fieldCaption: 'Month', fieldName: 'Month', logicalTableId: 'costs' },
    ],
    extraData: {
      parameters: [
        {
          parameterCaption: 'Period',
          parameterName: 'Parameter 1',
          parameterType: 'ANY_VALUE',
          dataType: 'INTEGER',
          value: 1,
        },
      ],
    },
  };
  const graph = { data: { publishedDatasources: [] } } as unknown as GraphQLResponse;
  for (const result of [simplifyReadMetadataResult(metadata), combineFields(metadata, graph)]) {
    expect(result.fieldGroups).toMatchObject([
      { logicalTableId: 'headcount', fields: [{ name: 'Month', fieldName: 'Month (HEADCOUNT)' }] },
      { logicalTableId: 'costs', fields: [{ name: 'Month', fieldName: 'Month' }] },
    ]);
    expect(result.parameters).toMatchObject([{ name: 'Period', parameterName: 'Parameter 1' }]);
  }
});
