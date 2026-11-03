import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { McpToolError } from '../../../errors/mcpToolError.js';
import { AxiosRequestConfig } from '../../../utils/axios.js';
import { createGuardedZodios } from '../../routeSafety/zodios.js';
import { subscriptionsApis } from '../apis/subscriptionsApi.js';
import { RestApiCredentials } from '../restApi.js';
import { Pagination, paginationSchema } from '../types/pagination.js';
import {
  CreateSubscriptionInput,
  Subscription,
  subscriptionScheduleSchema,
  subscriptionSchema,
} from '../types/subscription.js';
import AuthenticatedMethods from './authenticatedMethods.js';

const pageSchema = z.object({
  pagination: paginationSchema,
  subscriptions: z.object({ subscription: z.array(subscriptionSchema).max(100).optional() }),
});
const detailSchema = z.object({
  subscription: subscriptionSchema,
  schedule: subscriptionScheduleSchema.optional(),
});

function invalidResponse(): McpToolError {
  return new McpToolError({
    type: 'invalid-subscription-response',
    statusCode: 502,
    message: 'The Tableau subscription response could not be validated.',
  });
}

function parseDetail(raw: unknown): Result<Subscription, McpToolError> {
  const parsed = detailSchema.safeParse(raw);
  if (!parsed.success) return invalidResponse().toErr();
  return new Ok({
    ...parsed.data.subscription,
    ...(parsed.data.schedule && { schedule: parsed.data.schedule }),
  });
}

export default class SubscriptionsMethods extends AuthenticatedMethods<typeof subscriptionsApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(createGuardedZodios(baseUrl, subscriptionsApis, { axiosConfig }), creds);
  }

  querySubscriptions = async ({
    siteId,
    pageNumber,
    pageSize,
  }: {
    siteId: string;
    pageNumber: number;
    pageSize: number;
  }): Promise<Result<{ subscriptions: Subscription[]; pagination: Pagination }, McpToolError>> => {
    const raw = await this._apiClient.querySubscriptions({
      params: { siteId },
      queries: { pageNumber, pageSize },
      ...this.authHeader,
    });
    const parsed = pageSchema.safeParse(raw);
    if (!parsed.success) return invalidResponse().toErr();
    const { pagination, subscriptions } = parsed.data;
    const data = subscriptions.subscription ?? [];
    if (
      !Number.isSafeInteger(pagination.totalAvailable) ||
      pagination.totalAvailable < 0 ||
      pagination.pageNumber !== pageNumber ||
      pagination.pageSize !== pageSize ||
      data.length > pageSize ||
      data.length > pagination.totalAvailable
    )
      return invalidResponse().toErr();
    return new Ok({ subscriptions: data, pagination });
  };

  getSubscription = async ({
    siteId,
    subscriptionId,
  }: {
    siteId: string;
    subscriptionId: string;
  }): Promise<Result<Subscription, McpToolError>> =>
    parseDetail(
      await this._apiClient.getSubscription({
        params: { siteId, subscriptionId },
        ...this.authHeader,
      }),
    );

  createSubscription = async ({
    siteId,
    userId,
    input,
  }: {
    siteId: string;
    userId: string;
    input: CreateSubscriptionInput;
  }): Promise<Result<Subscription, McpToolError>> => {
    const { contentType, contentId, schedule, sendIfViewEmpty, ...delivery } = input;
    const serverSchedule = 'id' in schedule;
    return parseDetail(
      await this._apiClient.createSubscription(
        {
          subscription: {
            ...delivery,
            content: {
              id: contentId,
              type: contentType,
              ...(sendIfViewEmpty !== undefined && { sendIfViewEmpty }),
            },
            user: { id: userId },
            ...(serverSchedule && { schedule }),
          },
          ...(!serverSchedule && { schedule }),
        },
        { params: { siteId }, ...this.authHeader },
      ),
    );
  };

  setSuspended = async ({
    siteId,
    subscriptionId,
    suspended,
  }: {
    siteId: string;
    subscriptionId: string;
    suspended: boolean;
  }): Promise<Result<Subscription, McpToolError>> =>
    parseDetail(
      await this._apiClient.updateSubscription(
        { subscription: { suspended } },
        { params: { siteId, subscriptionId }, ...this.authHeader },
      ),
    );
}
