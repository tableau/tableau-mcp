// Regenerate every derived docs artifact from the published markdown tree.
//
// One entry point so a source-sync / page rewrite refreshes the tool catalog
// and the agent-readable llms.txt files together. Called from:
//   - npm prestart / prebuild / pretypecheck
//   - sync-tool-docs writerHandoff.mjs (after pages are written)
//
// Dependency-free ESM. Node >= 18.

import { generateLlmsTxt } from './generateLlmsTxt.mjs';
import { generateToolCatalog } from './generateToolCatalog.mjs';

export function generateSiteData(options = {}) {
  const catalog = generateToolCatalog(options);
  const llms = generateLlmsTxt(options);
  return { catalog, llms };
}

function isMain() {
  return Boolean(process.argv[1] && process.argv[1].endsWith('generateSiteData.mjs'));
}

if (isMain()) {
  const { catalog, llms } = generateSiteData();
  console.log(
    `generateSiteData: ${catalog.count} tools, ${llms.pageCount} llms pages ` +
      `(index ${llms.llmsTxtBytes} bytes, full ${llms.llmsFullBytes} bytes)`,
  );
}
