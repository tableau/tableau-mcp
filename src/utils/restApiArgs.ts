import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import { Config } from '../config.js';
import { Server } from '../server.js';
import { TableauAuthInfo } from '../server/oauth/schemas.js';

export type RestApiArgs = {
  config: Config;
  requestId: RequestId;
  server: Server;
  signal: AbortSignal;
  disableLogging?: boolean;
  authInfo?: TableauAuthInfo;
};
