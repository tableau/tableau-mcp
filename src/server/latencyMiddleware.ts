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
      const toolName = getToolNameFromRequestBody(req.body);

      // only record latency for tool calls
      if (toolName) {
        const durationMs = performance.now() - start;
        const authExtra = getTableauAuthInfo(req.auth);
        provider.recordHistogram(config.latencyMetricName, durationMs, {
          'http.request.method': req.method,
          'http.route': req.route?.path ?? req.path,
          'http.response.status_code': res.statusCode,
          tool_name: toolName,
          server: config.server,
          site_id: authExtra?.siteId,
        });
      }
    });

    next();
  };
}
