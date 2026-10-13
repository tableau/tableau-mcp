import { ExchangeInputError } from '../../errors/mcpToolError.js';
import { ExchangeAsset } from '../types.js';
import { SearchEngine } from './SearchEngine.js';

const asset: ExchangeAsset = {
  id: 1,
  type: 'extension',
  name: 'Export',
  shortDescription: 'Export',
  publisher: { id: 1, name: 'Export' },
  tags: [
    {
      id: 1,
      name: 'Export',
      canonicalName: 'Export',
      type: 'feature',
      applicableProductType: 'extension',
    },
  ],
  listingUrl: 'https://exchange.example/products/1',
  communityContribution: false,
  technicalMetadataStatus: 'unavailable',
};
describe('SearchEngine', () => {
  const engine = new SearchEngine();
  it('adds the independent design weights exactly and supplies factual match fields', () => {
    const result = engine.search([asset], { query: 'export' }, 10).results[0];
    expect(result.score).toBe(368); // 120+80+60+45+20+15+8+5+15
    expect(result.matchedFields).toEqual(['name', 'description', 'tag', 'publisher']);
    expect(result.reasons).toContain('Exact name match');
  });
  it('requires an exact tag phrase and token boundaries, avoiding AI in paid', () => {
    const candidate = {
      ...asset,
      name: 'Paid',
      shortDescription: '',
      publisher: { id: 1, name: 'Vendor' },
      tags: [{ ...asset.tags[0], name: 'Export tables', canonicalName: 'Export tables' }],
    };
    expect(engine.search([candidate], { query: 'ai' }, 10).results).toEqual([]);
    expect(engine.search([candidate], { query: 'export' }, 10).results[0].score).toBe(30); // tag token 15 + all tokens 15, no exact tag phrase
  });
  it('applies canonical AND, type, publisher, community and reported-version filters before scoring', () => {
    expect(engine.search([asset], { query: 'export', assetTypes: ['skill'] }, 10).results).toEqual(
      [],
    );
    expect(engine.search([asset], { query: 'export', publisher: 'Other' }, 10).results).toEqual([]);
    expect(
      engine.search([asset], { query: 'export', communityContent: 'only' }, 10).results,
    ).toEqual([]);
    expect(
      engine.search([asset], { query: 'export', tableauVersion: '2024.1' }, 10).results,
    ).toEqual([]);
    const reported = { ...asset, minimumTableauVersion: '2024.1' };
    expect(
      engine.search([reported], { query: 'export', tableauVersion: '2023.1' }, 10).results,
    ).toEqual([]);
    expect(
      engine.search([reported], { query: 'export', tableauVersion: '2024.1' }, 10).results,
    ).toHaveLength(1);
    expect(engine.search([asset], { query: '', tags: ['Export', 'Viz Free'] }, 10).results).toEqual(
      [],
    );
    const localized = {
      ...asset,
      tags: [{ ...asset.tags[0], name: 'Gratuit', canonicalName: 'Free' }],
    };
    expect(engine.search([localized], { query: '', tags: ['Free'] }, 10).results).toHaveLength(1);
    expect(engine.search([localized], { query: '', tags: ['Gratuit'] }, 10).results).toEqual([]);
  });
  it('permits filtered browsing, rejects empty/no-token searches, and sorts ties by downloads/name/id', () => {
    for (const query of ['', '!!!', 'the and'])
      expect(() => engine.search([asset], { query }, 10)).toThrow();
    const results = engine.search(
      [
        { ...asset, id: 3, downloads: 1 },
        { ...asset, id: 2, downloads: 10 },
        { ...asset, id: 1, downloads: 10 },
      ],
      { query: '', assetTypes: ['extension'] },
      10,
    ).results;
    expect(results.map((result) => result.asset.id)).toEqual([1, 2, 3]);
  });
  it('does not inflate phrase or token scores when upstream tags are repeated', () => {
    const single = engine.search([asset], { query: 'export' }, 10).results[0];
    const repeated = engine.search(
      [{ ...asset, tags: Array.from({ length: 20 }, () => asset.tags[0]) }],
      { query: 'export' },
      10,
    ).results[0];
    expect(repeated.score).toBe(368);
    expect(repeated.score).toBe(single.score);
    expect(repeated.reasons).toEqual(single.reasons);
    expect(repeated.matchedFields).toEqual(single.matchedFields);
  });

  it.each([['!!!'], ['Export', '!!!'], ['—'], ['Export', '…']])(
    'rejects every tag that normalizes to empty: %j',
    (...tags) => {
      for (const query of ['', 'export'])
        expect(() => engine.search([asset], { query, tags }, 10)).toThrow(ExchangeInputError);
    },
  );

  it('normalizes accent and punctuation variants while retaining canonical AND filtering', () => {
    const candidate = {
      ...asset,
      tags: [
        { ...asset.tags[0], canonicalName: 'Café' },
        { ...asset.tags[0], id: 2, canonicalName: 'Free' },
      ],
    };
    expect(
      engine.search([candidate], { query: '', tags: ['CAFE!', 'Frée'] }, 10).results,
    ).toHaveLength(1);
    expect(
      engine.search([candidate], { query: '', tags: ['CAFE!', 'Viz Free'] }, 10).results,
    ).toEqual([]);
  });
});
