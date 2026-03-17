import express from 'express';
import { performance } from 'perf_hooks';

import { getConfig } from '../config.js';
import { TelemetryProvider } from '../telemetry/types.js';
import { getTableauAuthInfo } from './oauth/getTableauAuthInfo.js';
import { AuthenticatedRequest } from './oauth/types.js';
import { getToolNameFromRequestBody } from './requestUtils.js';

/**
 * Express middleware that records HTTP request latency as an OTel histogram.
 */
export function latencyMiddleware(provider: TelemetryProvider): express.RequestHandler {
  const config = getConfig();
  return (req: AuthenticatedRequest, res, next) => {
    const start = performance.now();

    res.on('finish', () => {
      const durationMs = performance.now() - start;

      const toolName = getToolNameFromRequestBody(req.body);
      const authExtra = getTableauAuthInfo(req.auth);

      // only record latency for tool calls
      if (toolName) {
        // '1agg1' is a placeholder required by the MonCloud APM agent's OtelFunnelMetricTransformer.
        // It gets replaced with statistical suffixes (min, max, avg, p50, median, p90, p95, p99),
        // producing distinct metric names like apm_http_server_min_request_duration, etc.
        provider.recordHistogram('http_server_1agg1_request_duration', durationMs, {
          'http.request.method': req.method,
          'http.route': req.route?.path ?? req.path,
          'http.response.status_code': res.statusCode,
          tool_name: toolName || undefined,
          server: config.server,
          site_id: authExtra?.siteId,
        });
      }
    });

    next();
  };
}
