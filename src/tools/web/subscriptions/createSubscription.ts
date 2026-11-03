import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { createSubscriptionInputSchema } from '../../../sdks/tableau/types/subscription.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import {
  getSubscriptionUserId,
  subscriptionContentAllowed,
  subscriptionContext,
  subscriptionError,
  subscriptionMatches,
} from './subscriptionUtils.js';

const paramsSchema = {
  contentType: createSubscriptionInputSchema
    .innerType()
    .shape.contentType.describe('Workbook or View.'),
  contentId: createSubscriptionInputSchema
    .innerType()
    .shape.contentId.describe('The LUID of accessible content to subscribe to.'),
  subject: createSubscriptionInputSchema
    .innerType()
    .shape.subject.describe('Nonblank email subject, at most 255 characters.'),
  schedule: createSubscriptionInputSchema
    .innerType()
    .shape.schedule.describe(
      'Tableau Server: {id: subscription schedule LUID}. Tableau Cloud (API 3.20+): {frequency, frequencyDetails: {start, end?, intervals: {interval: [...]}}}. Confirm the subscription timezone in Tableau before scheduling.',
    ),
  suspended: z
    .boolean()
    .optional()
    .describe('Create the subscription paused when true; default false.'),
  attachImage: z
    .boolean()
    .optional()
    .describe('Attach images (default true unless PDF-only delivery is requested).'),
  attachPdf: z
    .boolean()
    .optional()
    .describe('Attach a PDF when enabled by the site (default false).'),
  message: z
    .string()
    .max(10000)
    .optional()
    .describe('Optional email message, at most 10000 characters.'),
  sendIfViewEmpty: z
    .boolean()
    .optional()
    .describe('View only: send even when the view is empty (Tableau default true).'),
};

export const getCreateSubscriptionTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool: WebTool<typeof paramsSchema> = new WebTool({
    server,
    name: 'create-subscription',
    minRequiredRole: SiteRole.VIEWER,
    description:
      'Creates a workbook/view email subscription for you using your authenticated Tableau identity. This can send scheduled email; verify the content, subject, and schedule before calling. Requires content access, an email address on your Tableau account, enabled site subscriptions, and a supported schedule. Cloud custom schedules require Creator or Explorer and API 3.20+. Server uses an existing Subscription schedule ID. To create without deliveries, set suspended: true. Repeated calls create separate subscriptions; do not blindly retry after an uncertain response.',
    paramsSchema,
    annotations: {
      title: 'Create Subscription',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    callback: async (args, extra) =>
      tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          const input = createSubscriptionInputSchema.safeParse(args);
          if (!input.success)
            return new ArgsValidationError(
              input.error.issues.map((issue) => issue.message).join(' '),
            ).toErr();
          if (!('id' in input.data.schedule)) {
            const [major, minor] = RestApi.version.split('.').map(Number);
            if (major < 3 || (major === 3 && minor < 20))
              return new ArgsValidationError(
                'Cloud custom subscription schedules require REST API 3.20 or later.',
              ).toErr();
          }
          const quiet = await subscriptionContext(extra);
          const content = { type: input.data.contentType, id: input.data.contentId };
          if (!(await subscriptionContentAllowed(content, quiet)))
            return subscriptionError().toErr();
          return useRestApi({
            ...quiet,
            jwtScopes: ['tableau:tasks:create'],
            callback: async (restApi) => {
              const user = await getSubscriptionUserId(restApi);
              if (user.isErr()) return user;
              const result = await restApi.subscriptionsMethods.createSubscription({
                siteId: restApi.siteId,
                userId: user.value,
                input: input.data,
              });
              if (result.isErr()) return result;
              if (!subscriptionMatches(result.value, user.value, content))
                return subscriptionError(
                  'The creation response did not match the requested user and content. Do not retry automatically; inspect your subscriptions first.',
                ).toErr();
              return new Ok(result.value);
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
