import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { getSetSubscriptionSuspendedTool } from './setSubscriptionSuspended.js';
import { subscriptionIdParamsSchema } from './subscriptionUtils.js';

export const getResumeSubscriptionTool = (
  server: WebMcpServer,
): WebTool<typeof subscriptionIdParamsSchema> => getSetSubscriptionSuspendedTool(server, false);
