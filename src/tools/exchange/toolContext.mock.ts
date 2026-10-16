import { getExchangeConfig } from '../../config.exchange.js';
import { ExchangeMcpServer } from '../../server.exchange.js';
import { TableauExchangeRequestHandlerExtra } from './toolContext.js';

export function getMockExchangeServer(): ExchangeMcpServer {
  return new ExchangeMcpServer({
    config: getExchangeConfig({
      GALLERY_API_BASE_URL: 'https://gallery.example/',
      EXCHANGE_WEB_BASE_URL: 'https://exchange.example/',
    }),
  });
}
export function getMockRequestHandlerExtra(
  server = getMockExchangeServer(),
): TableauExchangeRequestHandlerExtra {
  return {
    config: server.config,
    server,
    signal: new AbortController().signal,
    requestId: 2,
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  };
}
