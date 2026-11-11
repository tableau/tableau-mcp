import {
  FieldsResult,
  fieldsResultSchema,
} from '../../src/tools/web/getDatasourceMetadata/datasourceMetadataUtils.js';
import invariant from '../../src/utils/invariant.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../testEnv.js';
import { McpClient } from './mcpClient.js';

describe('get-datasource-metadata', () => {
  let client: McpClient;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    client = new McpClient();
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it('should get metadata', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const { fieldGroups } = await client.callTool('get-datasource-metadata', {
      schema: fieldsResultSchema,
      toolArgs: {
        datasourceLuid: superstore.id,
      },
    });

    invariant(fieldGroups, 'fieldGroups is undefined');
    const flatFields = fieldGroups.flatMap((group) => group.fields ?? []);
    expect(flatFields.length).toBeGreaterThan(0);

    const fieldNames = flatFields.map((field) => field.name);
    expect(fieldNames).toContain('Postal Code');
    expect(fieldNames).toContain('Product Name');
  });

  describe('field selectors', () => {
    let full: FieldsResult;
    let datasourceLuid: string;

    beforeAll(async () => {
      datasourceLuid = getSuperstoreDatasource().id;
      full = await metadata();
      expect(full).not.toHaveProperty('mcp');
    });

    async function metadata(selectors: Record<string, unknown> = {}): Promise<FieldsResult> {
      return client.callTool('get-datasource-metadata', {
        schema: fieldsResultSchema,
        toolArgs: { datasourceLuid, ...selectors },
      });
    }

    function expectSelection(
      selected: FieldsResult,
      names: string[],
      unknownFieldNames: string[] = [],
    ): void {
      const fields = full.fieldGroups.flatMap((group) => group.fields);
      const expected = fields.filter((field) => names.includes(field.name ?? ''));
      expect(expected).toHaveLength(names.length);
      expect(selected.fieldGroups.flatMap((group) => group.fields)).toEqual(expected);
      expect({ ...selected, fieldGroups: full.fieldGroups, mcp: undefined }).toEqual(full);
      expect(selected.mcp?.resultInfo).toEqual({
        totalFields: fields.length,
        matchedFields: expected.length,
        unknownFieldNames,
      });
    }

    it('selects exact captions and preserves complete metadata', async () => {
      const selected = await metadata({ fieldNames: ['Postal Code', 'Product Name'] });
      expectSelection(selected, ['Postal Code', 'Product Name']);
    });

    it('searches captions and descriptions without case sensitivity', async () => {
      const selected = await metadata({ search: 'pOsTaL' });
      const fields = full.fieldGroups.flatMap((group) => group.fields);
      const expected = fields.filter((field) =>
        [field.name, field.description].some((value) => value?.toLowerCase().includes('postal')),
      );
      expect(expected.map((field) => field.name)).toContain('Postal Code');
      expect(selected.fieldGroups.flatMap((group) => group.fields)).toEqual(expected);
      expect({ ...selected, fieldGroups: full.fieldGroups, mcp: undefined }).toEqual(full);
      expect(selected.mcp?.resultInfo).toEqual({
        totalFields: fields.length,
        matchedFields: expected.length,
        unknownFieldNames: [],
      });
    });

    it('combines selectors with AND and reports only unknown captions', async () => {
      const selected = await metadata({
        fieldNames: ['Postal Code', 'Product Name', '__missing_metadata_field__'],
        search: 'pOsTaL',
      });
      expectSelection(selected, ['Postal Code'], ['__missing_metadata_field__']);
    });

    it('returns no fields for an unknown caption', async () => {
      const selected = await metadata({ fieldNames: ['__missing_metadata_field__'] });
      expectSelection(selected, [], ['__missing_metadata_field__']);
      expect(selected.fieldGroups).toEqual([]);
    });

    it.each([{ fieldNames: [] }, { search: '   ' }])(
      'rejects empty selectors: %j',
      async (selectors) => {
        const result = await client.client.callTool({
          name: 'get-datasource-metadata',
          arguments: { datasourceLuid, ...selectors },
        });
        expect(result.isError).toBe(true);
      },
    );
  });
});
