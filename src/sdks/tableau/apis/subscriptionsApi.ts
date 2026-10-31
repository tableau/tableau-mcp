import { makeApi } from '@zodios/core';
import { z } from 'zod';

import { pathParam } from '../../routeSafety/ids.js';

/** Response parsing in SubscriptionsMethods returns sanitized typed validation errors. */
export const subscriptionsApis = makeApi([
  {
    method: 'get',
    path: '/sites/:siteId/subscriptions',
    alias: 'querySubscriptions',
    parameters: [
      pathParam('siteId', 'segment'),
      { name: 'pageSize', type: 'Query', schema: z.number().int().min(1).max(100) },
      { name: 'pageNumber', type: 'Query', schema: z.number().int().positive() },
    ],
    response: z.unknown(),
  },
  {
    method: 'get',
    path: '/sites/:siteId/subscriptions/:subscriptionId',
    alias: 'getSubscription',
    parameters: [pathParam('siteId', 'segment'), pathParam('subscriptionId')],
    response: z.unknown(),
  },
  {
    method: 'post',
    path: '/sites/:siteId/subscriptions',
    alias: 'createSubscription',
    parameters: [
      pathParam('siteId', 'segment'),
      {
        name: 'body',
        type: 'Body',
        schema: z.object({
          subscription: z.object({
            subject: z.string(),
            suspended: z.boolean().optional(),
            attachImage: z.boolean().optional(),
            attachPdf: z.boolean().optional(),
            message: z.string().optional(),
            content: z.object({
              id: z.string(),
              type: z.enum(['Workbook', 'View']),
              sendIfViewEmpty: z.boolean().optional(),
            }),
            user: z.object({ id: z.string() }),
            schedule: z.object({ id: z.string() }).optional(),
          }),
          schedule: z.unknown().optional(),
        }),
      },
    ],
    response: z.unknown(),
  },
  {
    method: 'put',
    path: '/sites/:siteId/subscriptions/:subscriptionId',
    alias: 'updateSubscription',
    parameters: [
      pathParam('siteId', 'segment'),
      pathParam('subscriptionId'),
      {
        name: 'body',
        type: 'Body',
        schema: z.object({ subscription: z.object({ suspended: z.boolean() }).strict() }).strict(),
      },
    ],
    response: z.unknown(),
  },
]);
