import { describe, expect, it } from 'vitest';
import { matchSentiment, sentimentMapSchema } from './sentimentMap.js';

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
      cost: 'SENTIMENT_TYPE_DOWN_IS_GOOD',
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
});
