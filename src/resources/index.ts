import { getConfig } from '../config.js';
import { WebMcpServer } from '../server.web.js';
import { WebResourceFactory } from './registry.js';
import { getVibeCodeDataAppSkillResource } from './skills/vibeCodeDataAppResource.js';

const webResourceFactories: ReadonlyArray<WebResourceFactory> = [getVibeCodeDataAppSkillResource];

export const registerResources = (server: WebMcpServer): void => {
  const config = getConfig();
  for (const factory of webResourceFactories) {
    const resource = factory(server);
    if (resource.disabled(config)) {
      continue;
    }
    server.mcpServer.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async () => resource.read(),
    );
  }
};
