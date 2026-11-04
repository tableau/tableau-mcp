import { buildDesktopInstructions } from './desktop/instructions.js';
import { buildWebInstructions } from './server.web.js';

export function buildCombinedInstructions(
  options: Parameters<typeof buildDesktopInstructions>[0],
): string {
  return `${buildWebInstructions()} ${buildDesktopInstructions(options)}`;
}
