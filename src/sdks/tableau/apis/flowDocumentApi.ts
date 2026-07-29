import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';

import { flowDocumentSchema } from '../types/flowDocument.js';

// Experimental endpoint. It lives under `/api/exp` (NOT the versioned `/api/3.x`
// path the other flow endpoints use), so it is exposed through its own methods
// class whose base URL is `${host}/api/exp` (see RestApi.flowDocumentMethods).
const getFlowDocumentEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/flows/:flowId/document',
  alias: 'getFlowDocument',
  description:
    "Returns the specified flow's document as sanitized JSON. Experimental API (api/exp) that must be enabled server-side; requires the tableau:flows:download scope.",
  response: flowDocumentSchema,
});

const flowDocumentApi = makeApi([getFlowDocumentEndpoint]);

export const flowDocumentApis = [...flowDocumentApi] as const satisfies ZodiosEndpointDefinitions;
