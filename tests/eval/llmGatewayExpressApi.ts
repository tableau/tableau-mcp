import { makeApi, Zodios, ZodiosInstance } from '@zodios/core';
import { z } from 'zod';

const LLM_GATEWAY_EXPRESS_URL =
  'https://eng-ai-model-gateway.sfproxy.devx.aws-dev2-uswest2.aws.sfdc.cl';

const modelsResponseSchema = z
  .object({
    data: z.array(
      z.object({
        id: z.string(),
        object: z.string(),
        created: z.number(),
        owned_by: z.string(),
      }),
    ),
  })
  .transform(({ data }) => ({
    data: data.map((model) => ({
      id: model.id,
      object: model.object,
      created: model.created,
      ownedBy: model.owned_by,
    })),
  }));

export const llmGatewayExpressApi = makeApi([
  {
    method: 'get',
    path: '/v1/models',
    alias: 'models',
    response: modelsResponseSchema,
  },
]);

function getClient(): ZodiosInstance<typeof llmGatewayExpressApi> {
  return new Zodios(LLM_GATEWAY_EXPRESS_URL, llmGatewayExpressApi);
}

export async function getSupportedModels(apiKey: string): Promise<string[]> {
  const response = await getClient().models({
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  return response.data.map((model) => model.id);
}
