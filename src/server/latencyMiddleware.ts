import express from 'express';
import { performance } from 'perf_hooks';

import { TelemetryProvider } from '../telemetry/types.js';
import { AuthenticatedRequest } from './oauth/types.js';
import { getToolNamesFromRequestBody } from './requestUtils.js';

/**
 * Express middleware that records HTTP request latency as an OTel histogram.
 *
 * Accepts a lazy provider getter so the middleware can be registered at startup
 * before the telemetry provider is fully initialized.
 */
export function latencyMiddleware(getProvider: () => TelemetryProvider): express.RequestHandler {
  return (req: AuthenticatedRequest, res, next) => {
    const start = performance.now();

    res.on('finish', () => {
      const durationMs = performance.now() - start;

      const toolNames = getToolNamesFromRequestBody(req.body);

      const authExtra = req.auth?.extra as
        | { server?: string; siteId?: string; userId?: string }
        | undefined;

      getProvider().recordHistogram('apm_nodejs_http_server_request_duration', durationMs, {
        'http.request.method': req.method,
        'http.route': req.route?.path ?? req.path,
        'http.response.status_code': res.statusCode,
        tool_name: toolNames.join(',') || undefined,
        server: authExtra?.server,
        site_id: authExtra?.siteId,
      });
    });

    next();
  };
}
