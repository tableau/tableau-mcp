import { INSIGHT_BUNDLE_ARTIFACT_TYPE, utteranceFromWire, utteranceToWire } from './utterance.js';
import {
  askUtteranceFromInput,
  insightBundleUtterance,
  queryDataUtterance,
  summaryDataUtterance,
} from './utteranceMark.js';

describe('utteranceMark', () => {
  it('builds a result table from summary columns and rows', () => {
    const utterance = summaryDataUtterance({
      caption: 'Sales by Region',
      columns: [{ name: 'Region' }, { name: 'SUM(Sales)' }],
      rows: [
        ['West', 1200],
        ['East', 900],
      ],
    });
    expect(utteranceFromWire(utteranceToWire(utterance))).toEqual({
      kind: 'result',
      body: {
        type: 'table',
        caption: 'Sales by Region',
        columns: ['Region', 'SUM(Sales)'],
        rows: [
          ['West', '1200'],
          ['East', '900'],
        ],
      },
    });
  });

  it('builds a result table from query object rows', () => {
    const utterance = queryDataUtterance([
      { Category: 'Technology', 'SUM(Profit)': 146543.37 },
      { Category: 'Furniture', 'SUM(Profit)': 19729.99 },
    ]);
    expect(utterance.kind).toBe('result');
    expect(utterance.body).toEqual({
      type: 'table',
      columns: ['Category', 'SUM(Profit)'],
      rows: [
        ['Technology', '146543.37'],
        ['Furniture', '19729.99'],
      ],
    });
  });

  it('returns an empty table when query data is missing', () => {
    expect(queryDataUtterance(undefined).body).toEqual({ type: 'table', columns: [], rows: [] });
  });

  it('marks blocking asks as question and two options as binary', () => {
    const utterance = askUtteranceFromInput({
      question: 'Which measure?',
      urgency: 'blocking',
      options: ['Sales', 'Profit'],
    });
    expect(utterance).toEqual({
      kind: 'question',
      body: {
        type: 'ask',
        stem: 'Which measure?',
        mode: 'binary',
        options: [{ pick: 'Sales' }, { pick: 'Profit' }],
      },
    });
  });

  it('marks soft asks as proposal', () => {
    expect(askUtteranceFromInput({ question: 'Use monthly grain?', urgency: 'soft' }).kind).toBe(
      'proposal',
    );
  });

  it('wraps a pulse bundle as a delivery artifact', () => {
    const payload = { bundle_response: { result: { insight_groups: [] } } };
    const utterance = insightBundleUtterance(payload);
    expect(utterance).toEqual({
      kind: 'delivery',
      body: { type: 'artifact', artifactType: INSIGHT_BUNDLE_ARTIFACT_TYPE, payload },
    });
  });
});
