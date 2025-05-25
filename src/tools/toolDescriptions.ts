import { getConfig } from '../config.js';
import { isToolName, ToolName, toolNames } from './toolName.js';

type CustomToolDescription = { mode: 'append' | 'replace'; description: string };
type CustomToolDescriptions = { [key in ToolName]?: CustomToolDescription };

export function formatToolDescription(toolName: ToolName, initialDescription: string): string {
  const customDescription = getCustomToolDescriptions()[toolName];
  if (!customDescription) {
    return initialDescription;
  }

  const { mode, description } = customDescription;
  if (mode === 'append') {
    return `${initialDescription}\n${description}`;
  }
  return description;
}

function getCustomToolDescriptions(): CustomToolDescriptions {
  // Format: toolName1::mode::description||toolName2::mode::description||...
  const { customToolDescriptions } = getConfig();
  if (!customToolDescriptions) {
    return {};
  }

  return customToolDescriptions.split('||').reduce((acc, parts) => {
    const [toolName, mode, description] = parts.split('::');

    if (!isToolName(toolName)) {
      throw new Error(`Invalid tool name: ${toolName}. Must be one of: ${toolNames.join(', ')}`);
    }
    if (mode !== 'append' && mode !== 'replace') {
      throw new Error(`Invalid mode: ${mode}. Must be one of: append, replace`);
    }

    if (!description) {
      throw new Error(`Description is required for tool: ${toolName}`);
    }

    acc[toolName] = { mode, description };
    return acc;
  }, {} as CustomToolDescriptions);
}

export const exportedForTesting = {
  getCustomToolDescriptions,
};
