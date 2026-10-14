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

  it('ranks a rare query token above a token common across the catalog', () => {
    const listing = (id: number, name: string, downloads: number): ExchangeAsset => ({
      ...asset,
      id,
      name,
      shortDescription: '',
      publisher: { id: 1, name: 'Vendor' },
      tags: [],
      downloads,
    });
    const catalog = [
      listing(1, 'Tree Diagram', 1),
      ...Array.from({ length: 10 }, (_, index) => listing(index + 2, `Chart ${index}`, 1_000)),
    ];
    const results = engine.search(catalog, { query: 'tree chart' }, 10).results;
    expect(results[0].asset.id).toBe(1);
    expect(results[1].score).toBeLessThan(results[0].score);
    expect(results[1].reasons).toContain('Name token match: chart (common term)');
  });

  it('scales the all-tokens bonus down when every query token is common', () => {
    const catalog = Array.from({ length: 10 }, (_, index) => ({
      ...asset,
      id: index + 1,
      name: `Listing ${index}`,
      shortDescription: 'Sales pipeline',
      publisher: { id: 1, name: 'Vendor' },
      tags: [],
    }));
    const result = engine.search(catalog, { query: 'sales pipeline' }, 10).results[0];
    expect(result.reasons).toContain('All query tokens matched');
    expect(result.score).toBeLessThan(50); // description phrase 45 plus small common-term points
  });

  it('scores the publisher only when the query names that publisher', () => {
    const firstParty = {
      ...asset,
      name: 'Sankey',
      shortDescription: '',
      publisher: { id: 1, name: 'Salesforce' },
      tags: [],
    };
    const unrelated = { ...firstParty, id: 2, name: 'Gantt' };
    const mixed = engine.search([firstParty, unrelated], { query: 'salesforce sankey' }, 10);
    expect(mixed.results.map((result) => result.asset.id)).toEqual([1]);
    expect(mixed.results[0].matchedFields).toEqual(['name']);

    const byPublisher = engine.search([firstParty, unrelated], { query: 'salesforce' }, 10);
    expect(byPublisher.results).toHaveLength(2);
    expect(byPublisher.results[0].reasons).toContain('Publisher phrase match');
  });

  it('matches singular and plural word forms', () => {
    const maps = { ...asset, name: 'Maps Pro', shortDescription: 'Category explorer', tags: [] };
    expect(engine.search([maps], { query: 'map' }, 10).results).toHaveLength(1);
    expect(engine.search([maps], { query: 'categories' }, 10).results).toHaveLength(1);
    expect(engine.search([maps], { query: 'pros class' }, 10).results).toHaveLength(1);
  });

  describe('related terms', () => {
    const listing = (
      id: number,
      name: string,
      shortDescription = '',
      downloads = 1,
    ): ExchangeAsset => ({
      ...asset,
      id,
      name,
      shortDescription,
      publisher: { id: 1, name: 'Vendor' },
      tags: [],
      downloads,
    });
    const genericCharts = Array.from({ length: 10 }, (_, index) =>
      listing(100 + index, `Chart ${index}`, 'A chart', 1_000),
    );

    it('ranks listings matching related terms above listings matching only a common query word', () => {
      const catalog = [
        listing(1, 'Sankey Diagram'),
        listing(2, 'Process Analysis'),
        listing(3, 'Network Analysis'),
        ...genericCharts,
      ];
      const results = engine.search(catalog, { query: 'flow chart' }, 10).results;
      expect(results.slice(0, 3).map((result) => result.asset.id)).toEqual(
        expect.arrayContaining([1, 2, 3]),
      );
      expect(results.find((result) => result.asset.id === 1)?.reasons).toContain(
        'Related term match: sankey (via "flow chart")',
      );
    });

    it('finds listings for a query whose own words appear nowhere in the catalog', () => {
      const results = engine.search([listing(1, 'Sankey Diagram')], { query: 'flowchart' }, 10);
      expect(results.results.map((result) => result.asset.id)).toEqual([1]);
      expect(results.results[0].matchedFields).toEqual(['name']);
    });

    it('keeps a direct name match above a related-term-only match', () => {
      const catalog = [listing(1, 'Flowchart Builder'), listing(2, 'Sankey Process Network')];
      const results = engine.search(catalog, { query: 'flowchart' }, 10).results;
      expect(results.map((result) => result.asset.id)).toEqual([1, 2]);
    });

    it('does not award the all-tokens bonus for related terms alone', () => {
      const result = engine.search([listing(1, 'Sankey')], { query: 'flowchart' }, 10).results[0];
      expect(result.reasons).not.toContain('All query tokens matched');
    });

    it('counts the best related term fully and each additional one at a quarter', () => {
      const catalog = [listing(1, 'One', 'sankey'), listing(2, 'Two', 'process network workflow')];
      const scores = engine
        .search(catalog, { query: 'flowchart' }, 10)
        .results.map((result) => [result.asset.id, result.score]);
      expect(scores).toEqual([
        [2, 12], // 8 + 8/4 + 8/4
        [1, 8],
      ]);
    });

    it('leaves scores unchanged for queries without related terms', () => {
      expect(engine.search([asset], { query: 'export' }, 10).results[0].score).toBe(368);
    });
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
