import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../../config.js';

async function loadConfigWith(env: Record<string, string | undefined>): Promise<Config> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import('../../../../config.js');
  return new mod.Config();
}

describe('Config.insightSentimentMap', () => {
  const saved = process.env.INSIGHT_SENTIMENT_MAP;
  afterEach(() => {
    if (saved === undefined) delete process.env.INSIGHT_SENTIMENT_MAP;
    else process.env.INSIGHT_SENTIMENT_MAP = saved;
  });

  it('defaults to empty object when unset', async () => {
    const cfg = await loadConfigWith({ INSIGHT_SENTIMENT_MAP: undefined });
    expect(cfg.insightSentimentMap).toEqual({});
  });

  it('parses a JSON map', async () => {
    const cfg = await loadConfigWith({
      INSIGHT_SENTIMENT_MAP: JSON.stringify({ ARR: 'SENTIMENT_TYPE_UP_IS_GOOD' }),
    });
    expect(cfg.insightSentimentMap).toEqual({ ARR: 'SENTIMENT_TYPE_UP_IS_GOOD' });
  });

  it('fails closed to {} on malformed JSON without throwing', async () => {
    const cfg = await loadConfigWith({ INSIGHT_SENTIMENT_MAP: '{not valid json' });
    expect(cfg.insightSentimentMap).toEqual({});
  });

  it('fails closed to {} on an invalid sentiment token without throwing', async () => {
    const cfg = await loadConfigWith({
      INSIGHT_SENTIMENT_MAP: JSON.stringify({ ARR: 'NOT_A_REAL_TOKEN' }),
    });
    expect(cfg.insightSentimentMap).toEqual({});
  });
});
