import { desktopToolNames } from './desktop/toolName.js';
import { exchangeToolNames } from './exchange/toolName.js';
import { webToolNames } from './web/toolName.js';

export const toolNames = [...webToolNames, ...desktopToolNames, ...exchangeToolNames];
export type ToolName = (typeof toolNames)[number];
