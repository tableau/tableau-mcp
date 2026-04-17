import * as desktop from './desktopToolName';
import * as web from './webToolName';

export const toolNames =
  import.meta.env.BUILD_MODE === 'desktop' ? desktop.toolNames : web.toolNames;
export type ToolName = (typeof toolNames)[number];
export const toolGroupNames =
  import.meta.env.BUILD_MODE === 'desktop' ? desktop.toolGroupNames : web.toolGroupNames;
export type ToolGroupName = (typeof toolGroupNames)[number];
export const toolGroups =
  import.meta.env.BUILD_MODE === 'desktop' ? desktop.toolGroups : web.toolGroups;
export const isToolName =
  import.meta.env.BUILD_MODE === 'desktop' ? desktop.isToolName : web.isToolName;
export const isToolGroupName =
  import.meta.env.BUILD_MODE === 'desktop' ? desktop.isToolGroupName : web.isToolGroupName;
export const getToolsFromValue =
  import.meta.env.BUILD_MODE === 'desktop' ? desktop.getToolsFromValue : web.getToolsFromValue;
