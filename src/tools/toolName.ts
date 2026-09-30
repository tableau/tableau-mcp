import { desktopToolNames } from './desktop/toolName.js';
import { localToolNames } from './local/toolName.js';
import { sharedToolNames } from './shared/toolName.js';
import { webToolNames } from './web/toolName.js';

export const toolNames = [
  ...webToolNames,
  ...desktopToolNames,
  ...sharedToolNames,
  ...localToolNames,
];
export type ToolName = (typeof toolNames)[number];
