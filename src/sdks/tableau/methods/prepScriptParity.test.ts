import { analyzePrepScript } from './prepScriptAnalysis.js';
import cases from './prepScriptParity.test.fixtures.json';

// Expectations captured independently from the exact d660ac7 reference module.
// CI only needs Node; the original analyzer is not shipped or invoked here.
describe('pinned script metadata behavior parity', () => {
  it.each(cases)(
    '$name matches the source schema, explicit references and conditional status',
    (item) => {
      const result = analyzePrepScript(
        Buffer.from(item.sourceBase64, 'base64'),
        item.language as 'python' | 'r',
      );
      expect({
        sourceSha256: result.sourceSha256,
        fields: result.fields,
        schemaStatus: result.schemaStatus,
        nativeExecutionVerified: result.nativeExecutionVerified,
        transform: result.functions.transform ?? null,
      }).toEqual(item.expected);
    },
  );
});
