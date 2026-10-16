import { ZodRawShape } from 'zod';

import { ExchangeConfig } from '../../config.exchange.js';
import { ExchangeMcpServer } from '../../server.exchange.js';
import { TableauRequestHandlerExtra, TableauToolCallback } from '../toolContext.js';

export type TableauExchangeRequestHandlerExtra = TableauRequestHandlerExtra<ExchangeMcpServer> & {
  config: ExchangeConfig;
};
export type TableauExchangeToolCallback<Args extends ZodRawShape> = TableauToolCallback<
  ExchangeMcpServer,
  TableauExchangeRequestHandlerExtra,
  Args
>;
