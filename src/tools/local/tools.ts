import type { TemplateRuntimeSnapshot } from '../../metadata/templates/templateRuntimeSnapshot.js';
import type { Server } from '../../server.js';
import { getReadCachedXmlTool } from './cache/readCachedXml.js';
import { getWriteCachedXmlTool } from './cache/writeCachedXml.js';
import { getInjectTemplateTool } from './injectTemplate.js';
import { getListFieldsTool } from './listFields.js';

type LocalTool = ReturnType<
  | typeof getInjectTemplateTool
  | typeof getListFieldsTool
  | typeof getReadCachedXmlTool
  | typeof getWriteCachedXmlTool
>;

export function localToolFactories(dependencies: {
  getCacheDir(): string;
  getRuntimeTemplateSnapshot(name: string): TemplateRuntimeSnapshot | null;
  listTemplateNames(): string[];
}): Array<(server: Server) => LocalTool> {
  return [
    (server: Parameters<typeof getInjectTemplateTool>[0]) =>
      getInjectTemplateTool(server, dependencies),
    getListFieldsTool,
    (server: Parameters<typeof getReadCachedXmlTool>[0]) =>
      getReadCachedXmlTool(server, dependencies.getCacheDir),
    (server: Parameters<typeof getWriteCachedXmlTool>[0]) =>
      getWriteCachedXmlTool(server, dependencies.getCacheDir),
  ];
}
