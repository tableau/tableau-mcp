import { mockPulseMetricDefinitions } from '../../../tools/web/pulse/mockPulseMetricDefinitions.js';
import PulseMethods from './pulseMethods.js';

describe('TEST-PULSEPAGE-SDK: Pulse metrics pagination through the REST SDK', () => {
  const definitionId = 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3';
  const metric = mockPulseMetricDefinitions[0].metrics[0];

  it('preserves continuation metadata and sends opaque tokens and false follower filters as queries', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({
      data: { metrics: [metric], next_page_token: 'next/+&=', total_available: '77', offset: '10' },
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      config,
    }));
    const methods = new PulseMethods(
      'https://tableau.example/api/-',
      { type: 'Bearer', token: 'test' },
      { adapter },
    );
    const signal = new AbortController().signal;
    const result = await methods.listPulseMetricsFromMetricDefinitionId(
      definitionId,
      'previous/+&=',
      10,
      false,
      signal,
    );
    expect(result.unwrap()).toMatchObject({
      pagination: { next_page_token: 'next/+&=', total_available: 77 },
      metrics: [{ id: metric.id }],
    });
    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `/pulse/definitions/${definitionId}/metrics`,
        params: {
          page_token: 'previous/+&=',
          page_size: 10,
          exclude_metrics_without_followers: false,
        },
        signal,
      }),
    );
    expect(adapter.mock.calls[0][0].headers.get('Authorization')).toBe('Bearer test');
  });

  it.each([undefined, ''])('accepts a terminal response token %s', async (token) => {
    const methods = new PulseMethods(
      'https://tableau.example/api/-',
      { type: 'Bearer', token: 'test' },
      {
        adapter: async (config) => ({
          data: { metrics: [], total_available: 0, next_page_token: token },
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          config,
        }),
      },
    );
    expect((await methods.listPulseMetricsFromMetricDefinitionId(definitionId)).unwrap()).toEqual({
      metrics: [],
      pagination: { next_page_token: token, total_available: 0 },
    });
  });
});
import type { InternalAxiosRequestConfig } from 'axios';
