#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

// Read tool names from the toolName.ts file
const toolNameContent = fs.readFileSync(path.join(__dirname, '../src/tools/toolName.ts'), 'utf8');
const toolNamesMatch = toolNameContent.match(/export const toolNames = \[([\s\S]*?)\]/);
const toolNames = toolNamesMatch
  ? toolNamesMatch[1]
      .split(',')
      .map((name) => name.trim().replace(/'/g, ''))
      .filter((name) => name.length > 0)
  : [];

// Read README.md to extract environment variables
const readmeContent = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');

// Function to parse markdown table and extract environment variables
/**
 * @param {string} content - The markdown content to parse
 * @param {string} sectionStart - The start marker for the section
 * @param {string} sectionEnd - The end marker for the section
 * @returns {Array<{name: string, description: string, required: boolean, sensitive: boolean}>}
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function parseEnvVarsFromTable(content, sectionStart, sectionEnd) {
  const startIndex = content.indexOf(sectionStart);
  if (startIndex === -1) return [];

  const endIndex = content.indexOf(sectionEnd, startIndex);
  if (endIndex === -1) return [];

  const sectionContent = content.substring(startIndex, endIndex);

  // Find the table in the section - look for lines that start with |
  const lines = sectionContent.split('\n');
  const tableLines = [];
  let inTable = false;

  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      inTable = true;
      tableLines.push(line);
    } else if (inTable && line.trim() === '') {
      break; // End of table
    }
  }

  const vars = [];
  for (let i = 2; i < tableLines.length; i++) {
    // Skip header and separator rows
    const line = tableLines[i];
    const columns = line
      .split('|')
      .map((col) => col.trim())
      .filter((col) => col.length > 0);

    if (columns.length >= 2) {
      const varName = columns[0].replace(/`/g, '').trim();
      const description = columns[1].trim();

      // Skip if this looks like a separator line (all dashes)
      if (varName.match(/^-+$/)) continue;

      const isSensitive = description.includes('(Sensitive)');

      vars.push({
        name: varName,
        description: description.replace('(Sensitive)', '').trim(),
        required: sectionStart.includes('Required'),
        sensitive: isSensitive,
      });
    }
  }

  return vars;
}

// Extract required and optional environment variables
const requiredVars = parseEnvVarsFromTable(
  readmeContent,
  '#### Required Environment Variables',
  '#### Optional Environment Variables',
);

const optionalVars = parseEnvVarsFromTable(
  readmeContent,
  '#### Optional Environment Variables',
  '##### DATASOURCE_CREDENTIALS',
);

// Combine all environment variables
const allVars = [...requiredVars, ...optionalVars];

// Create user_config object
const userConfig = {};
allVars.forEach((variable) => {
  const key = variable.name.toLowerCase().replace(/_/g, '_');
  userConfig[key] = {
    type: 'string',
    title: variable.name,
    description: variable.description,
    required: variable.required,
    sensitive: variable.sensitive,
  };
});

// Create tools array
const tools = toolNames.map((name) => ({ name }));

// Create env object for server configuration
const env = {};
allVars.forEach((variable) => {
  const key = variable.name;
  env[key] = `\${user_config.${variable.name.toLowerCase().replace(/_/g, '_')}}`;
});

// Create the manifest object
const manifest = {
  dxt_version: '0.1',
  name: packageJson.name,
  version: packageJson.version,
  description: packageJson.description,
  author: {
    name: 'Tableau',
  },
  homepage: packageJson.homepage,
  license: packageJson.license,
  server: {
    type: 'node',
    entry_point: 'build/index.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/build/index.js'],
      env,
    },
  },
  tools,
  user_config: userConfig,
};

// Write the manifest file
fs.writeFileSync(path.join(__dirname, '../manifest.json'), JSON.stringify(manifest, null, 2));

console.log('✅ Manifest file generated successfully at ./manifest.json');
