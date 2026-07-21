import { WebMcpServer } from '../server.web.js';
import { getDataAppPreviewResource } from './dataApps/dataAppPreviewResource.js';
import { WebResourceFactory, WebTemplateResourceFactory } from './registry.js';
import { getBuildDataAppResource } from './skills/buildDataAppResource.js';

// The build-data-app skill and the data-app preview template are the two halves of the data-app
// workspace workflow's resource surface. They are gated together with the workspace tools (see
// `RegisterResourcesOptions.dataAppWorkspacesEnabled`) so a deployment with the feature off never
// advertises workflow guidance or a preview endpoint for tools it does not expose.
const dataAppResourceFactories: ReadonlyArray<WebResourceFactory> = [getBuildDataAppResource];

const dataAppTemplateResourceFactories: ReadonlyArray<WebTemplateResourceFactory> = [
  getDataAppPreviewResource,
];

// Resources that are always advertised regardless of the data-app rollout gate. There are none
// today, but the split keeps the gate honest: adding a non-data-app resource here does not
// accidentally couple it to the data-app feature flag.
const alwaysOnResourceFactories: ReadonlyArray<WebResourceFactory> = [];
const alwaysOnTemplateResourceFactories: ReadonlyArray<WebTemplateResourceFactory> = [];

export type RegisterResourcesOptions = {
  /**
   * When false, the data-app workspace workflow resources (build-data-app skill + preview template)
   * are withheld so a disabled deployment advertises no part of the workflow. Callers must pass the
   * gate snapshot explicitly; there is no fail-open default.
   */
  dataAppWorkspacesEnabled: boolean;
};

// Registers general-purpose MCP resources (e.g. skill guidance served as Markdown, and the dynamic
// data-app preview template). Kept separate from MCP Apps' `ui://` resources, which are registered
// per-tool in server.web.ts via registerAppResource and exist to serve app UI bundles, not agent
// guidance.
export const registerResources = (
  server: WebMcpServer,
  { dataAppWorkspacesEnabled }: RegisterResourcesOptions,
): void => {
  const webResourceFactories: ReadonlyArray<WebResourceFactory> = dataAppWorkspacesEnabled
    ? [...alwaysOnResourceFactories, ...dataAppResourceFactories]
    : alwaysOnResourceFactories;

  const webTemplateResourceFactories: ReadonlyArray<WebTemplateResourceFactory> =
    dataAppWorkspacesEnabled
      ? [...alwaysOnTemplateResourceFactories, ...dataAppTemplateResourceFactories]
      : alwaysOnTemplateResourceFactories;

  for (const factory of webResourceFactories) {
    const resource = factory(server);
    server.mcpServer.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      () => resource.read(),
    );
  }

  for (const factory of webTemplateResourceFactories) {
    const resource = factory(server);
    server.mcpServer.registerResource(
      resource.name,
      resource.template,
      {
        title: resource.title,
        description: resource.description,
        ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
      },
      resource.read,
    );
  }
};
