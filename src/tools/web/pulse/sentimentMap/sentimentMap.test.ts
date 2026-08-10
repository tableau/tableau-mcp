import { describe, expect, it } from 'vitest';

import {
  applySentimentToBundleRequest,
  matchSentiment,
  sentimentMapSchema,
} from './sentimentMap.js';

const MAP = sentimentMapSchema.parse({
  ARR: 'SENTIMENT_TYPE_UP_IS_GOOD',
  'Churn Rate': 'SENTIMENT_TYPE_DOWN_IS_GOOD',
});

describe('matchSentiment', () => {
  it('normalized-exact matches caption', () => {
    expect(matchSentiment(MAP, 'ARR', 'someField')).toBe('SENTIMENT_TYPE_UP_IS_GOOD');
  });
  it('normalized-exact matches localName when caption misses', () => {
    expect(matchSentiment(MAP, 'Total Bookings', 'arr')).toBe('SENTIMENT_TYPE_UP_IS_GOOD');
  });
  it('caption wins over localName on conflict', () => {
    const map = sentimentMapSchema.parse({
      Revenue: 'SENTIMENT_TYPE_UP_IS_GOOD',
      cost: 'SENTIMENT_TYPE_DOWN_IS_GOOD',
    });
    expect(matchSentiment(map, 'Revenue', 'cost')).toBe('SENTIMENT_TYPE_UP_IS_GOOD');
  });
  it('normalizes case/space/punctuation ("Churn Rate" matches "churn_rate")', () => {
    expect(matchSentiment(MAP, undefined, 'churn_rate')).toBe('SENTIMENT_TYPE_DOWN_IS_GOOD');
  });
  it('fuzzy: small edit distance matches ("Revenue" ~ "revenues")', () => {
    const map = sentimentMapSchema.parse({ Revenue: 'SENTIMENT_TYPE_UP_IS_GOOD' });
    expect(matchSentiment(map, 'revenues', undefined)).toBe('SENTIMENT_TYPE_UP_IS_GOOD');
  });
  it('fuzzy: rejects when over the distance threshold', () => {
    const map = sentimentMapSchema.parse({ Revenue: 'SENTIMENT_TYPE_UP_IS_GOOD' });
    expect(matchSentiment(map, 'expenses', undefined)).toBeUndefined();
  });
  it('fuzzy: rejects when two keys tie within threshold (ambiguous)', () => {
    const map = sentimentMapSchema.parse({
      cosh: 'SENTIMENT_TYPE_DOWN_IS_GOOD',
      cast: 'SENTIMENT_TYPE_UP_IS_GOOD',
    });
    // "cost" is edit-distance 1 from BOTH -> ambiguous -> no match
    expect(matchSentiment(map, 'cost', undefined)).toBeUndefined();
  });
  it('returns undefined for empty map', () => {
    expect(matchSentiment({}, 'ARR', 'arr')).toBeUndefined();
  });
  it('schema rejects an unknown token', () => {
    expect(() => sentimentMapSchema.parse({ ARR: 'SENTIMENT_TYPE_BOGUS' })).toThrow();
  });
  it('exact match returns immediately despite nearby fuzzy neighbors', () => {
    // Regression: exact-match should NOT be rejected due to close alternative keys.
    const map = sentimentMapSchema.parse({
      ARR: 'SENTIMENT_TYPE_UP_IS_GOOD',
      MRR: 'SENTIMENT_TYPE_DOWN_IS_GOOD',
    });
    // "ARR" exactly matches key "ARR"; even though "MRR" is nearby (distance 1),
    // exact match wins and returns immediately.
    expect(matchSentiment(map, 'ARR', undefined)).toBe('SENTIMENT_TYPE_UP_IS_GOOD');
  });
});

function reqWith(
  name: string,
  field: string,
  repOpts?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    bundle_request: {
      input: {
        metadata: { name },
        metric: {
          definition: {
            basic_specification: { measure: { field, aggregation: 'AGGREGATION_SUM' } },
            ...(repOpts ? { representation_options: repOpts } : {}),
          },
        },
      },
    },
  };
}

describe('applySentimentToBundleRequest', () => {
  const MAP = sentimentMapSchema.parse({ ARR: 'SENTIMENT_TYPE_UP_IS_GOOD' });

  it('sets sentiment_type on a match, creating representation_options', () => {
    const req = reqWith('ARR', 'arr');
    applySentimentToBundleRequest(req, MAP);
    expect(
      (req.bundle_request.input.metric.definition as Record<string, any>).representation_options
        .sentiment_type,
    ).toBe('SENTIMENT_TYPE_UP_IS_GOOD');
  });

  it('merges into an existing representation_options, preserving other fields', () => {
    const req = reqWith('ARR', 'arr', { type: 'NUMBER_FORMAT_TYPE_NUMBER' });
    applySentimentToBundleRequest(req, MAP);
    const ro = (req.bundle_request.input.metric.definition as Record<string, any>)
      .representation_options;
    expect(ro.type).toBe('NUMBER_FORMAT_TYPE_NUMBER');
    expect(ro.sentiment_type).toBe('SENTIMENT_TYPE_UP_IS_GOOD');
  });

  it('is a no-op when the measure does not match', () => {
    const req = reqWith('Expenses', 'expenses');
    applySentimentToBundleRequest(req, MAP);
    expect(
      (req.bundle_request.input.metric.definition as Record<string, any>).representation_options,
    ).toBeUndefined();
  });

  it('is a no-op on an unexpected shape (no throw)', () => {
    const junk = { bundle_request: {} } as unknown;
    expect(() => applySentimentToBundleRequest(junk, MAP)).not.toThrow();
  });

  it('is a no-op with an empty map', () => {
    const req = reqWith('ARR', 'arr');
    applySentimentToBundleRequest(req, {});
    expect(
      (req.bundle_request.input.metric.definition as Record<string, any>).representation_options,
    ).toBeUndefined();
  });
});
