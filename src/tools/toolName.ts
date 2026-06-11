import { desktopToolNames } from './desktop/toolName.js';
import { webToolNames } from './web/toolName.js';

export const toolNames = [...webToolNames, ...desktopToolNames];
export type ToolName = (typeof toolNames)[number];
