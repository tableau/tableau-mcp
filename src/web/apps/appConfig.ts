/**
 * Helper to generate MCP App configuration for tools.
 *
 * @param toolName - The tool name (e.g., 'get-workbook')
 * @returns App configuration object with name, resourceUri, and html path
 */
export function getAppConfig(toolName: string): {
  name: string;
  resourceUri: string;
  html: string;
} {
  return {
    name: `${toolName}-ui`,
    resourceUri: `ui://${toolName}/mcp-app.html`,
    html: 'web/apps/dist/mcp-app.html',
  };
}
