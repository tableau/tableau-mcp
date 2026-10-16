export const exchangeToolNames = [
  'search-exchange-assets',
  'get-exchange-asset',
  'compare-exchange-assets',
  'list-exchange-categories',
  'download-exchange-asset',
] as const;
export type ExchangeToolName = (typeof exchangeToolNames)[number];
export const isExchangeToolName = (name: string): name is ExchangeToolName =>
  exchangeToolNames.some((candidate) => candidate === name);
