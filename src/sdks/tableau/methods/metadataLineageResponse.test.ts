import MetadataMethods from './metadataMethods.js';

describe('Metadata lineage response transport', () => {
  it('preserves partial GraphQL errors through the real Zodios response pipeline', async () => {
    const response = {
      data: { asset: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
      errors: [{ message: 'dependency index incomplete', path: ['asset'] }],
    };
    const methods = new MetadataMethods(
      'https://tableau.example/api/metadata',
      { type: 'Bearer', token: 'test-only' },
      {
        adapter: async (config) => ({
          data: response,
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }),
      },
    );
    const result = await methods.graphql('query { __typename }');
    expect(result.errors).toEqual(response.errors);
    expect(result.data.asset).toEqual(response.data.asset);
  });
});
