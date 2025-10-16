import { makeApi } from '@zodios/core';

import { tableauAccessTokenRequestSchema, tableauAccessTokenResponseSchema } from './types.js';

export const tableauTokenApi = makeApi([
  {
    method: 'post',
    path: '/oauth2/v1/token',
    alias: 'token',
    response: tableauAccessTokenResponseSchema,
    parameters: [
      {
        name: 'body',
        type: 'Body',
        schema: tableauAccessTokenRequestSchema,
      },
    ],
  },
]);
