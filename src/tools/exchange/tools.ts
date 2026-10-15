import { getCompareExchangeAssetsTool } from './compareExchangeAssets.js';
import { getDownloadExchangeAssetTool } from './downloadExchangeAsset.js';
import { getGetExchangeAssetTool } from './getExchangeAsset.js';
import { getListExchangeCategoriesTool } from './listExchangeCategories.js';
import { getSearchExchangeAssetsTool } from './searchExchangeAssets.js';

export const exchangeToolFactories = [
  getSearchExchangeAssetsTool,
  getGetExchangeAssetTool,
  getCompareExchangeAssetsTool,
  getListExchangeCategoriesTool,
  getDownloadExchangeAssetTool,
] as const;
