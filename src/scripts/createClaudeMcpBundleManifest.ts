#!/usr/bin/env node
/* eslint-disable no-console */

import { McpbManifestSchema, McpbUserConfigurationOptionSchema } from '@anthropic-ai/mcpb';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

import packageJson from '../../package.json' with { type: 'json' };
import { ProcessEnvEx } from '../../types/process-env.js';
import { toolNames } from '../tools/toolName.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type McpbUserConfigurationOption = z.infer<typeof McpbUserConfigurationOptionSchema>;
type McpbManifest = z.infer<typeof McpbManifestSchema>;

type EnvVars = {
  [TKey in keyof ProcessEnvEx]: McpbUserConfigurationOption & {
    includeInUserConfig: boolean;
  };
};

const envVars = {
  AUTH: {
    includeInUserConfig: false,
    type: 'string',
    title: 'Authentication Method',
    description:
      'The authentication method to use by the server. Possible values are `pat` or `direct-trust`.',
    required: false,
    sensitive: false,
  },
  SERVER: {
    includeInUserConfig: true,
    type: 'string',
    title: 'Server',
    description: 'The URL of the Tableau server e.g. https://tableau.example.com',
    required: true,
    sensitive: false,
  },
  SITE_NAME: {
    includeInUserConfig: true,
    type: 'string',
    title: 'Site Name',
    description:
      'The name of the Tableau site to use. For Tableau Server, leave this empty to specify the default site.',
    required: false,
    sensitive: false,
  },
  PAT_NAME: {
    includeInUserConfig: true,
    type: 'string',
    title: 'PAT Name',
    description: 'The name of the Tableau Personal Access Token to use for authentication.',
    required: true,
    sensitive: false,
  },
  PAT_VALUE: {
    includeInUserConfig: true,
    type: 'string',
    title: 'PAT Value',
    description: 'The value of the Tableau Personal Access Token to use for authentication.',
    required: true,
    sensitive: true,
  },
  JWT_SUB_CLAIM: {
    includeInUserConfig: false,
    type: 'string',
    title: 'JWT Sub Claim',
    description: 'The username for the `sub` claim of the JWT.',
    required: false,
    sensitive: false,
  },
  CONNECTED_APP_CLIENT_ID: {
    includeInUserConfig: false,
    type: 'string',
    title: 'Connected App Client ID',
    description: 'The client ID of the Tableau Connected App.',
    required: false,
    sensitive: false,
  },
  CONNECTED_APP_SECRET_ID: {
    includeInUserConfig: false,
    type: 'string',
    title: 'Connected App Secret ID',
    description: 'The secret ID of the Tableau Connected App.',
    required: false,
    sensitive: false,
  },
  CONNECTED_APP_SECRET_VALUE: {
    includeInUserConfig: false,
    type: 'string',
    title: 'Connected App Secret Value',
    description: 'The secret value of the Tableau Connected App.',
    required: false,
    sensitive: true,
  },
  JWT_ADDITIONAL_PAYLOAD: {
    includeInUserConfig: false,
    type: 'string',
    title: 'JWT Additional Payload',
    description:
      'A JSON string that includes any additional user attributes to include on the JWT.',
    required: false,
    sensitive: false,
  },
  TRANSPORT: {
    includeInUserConfig: false,
    type: 'string',
    title: 'MCP Transport',
    description: 'The MCP transport type to use for the server.',
    required: false,
    sensitive: false,
  },
  ENABLE_SERVER_LOGGING: {
    includeInUserConfig: false,
    type: 'string',
    title: 'Enable Server Logging',
    description: 'Enable logging of server activity to local files.',
    required: false,
    sensitive: false,
  },
  SERVER_LOG_DIRECTORY: {
    includeInUserConfig: false,
    type: 'string',
    title: 'Server Log Directory',
    description: 'The directory to write the server logs to when ENABLE_SERVER_LOGGING is true.',
    required: false,
    sensitive: false,
  },
  DEFAULT_LOG_LEVEL: {
    includeInUserConfig: false,
    type: 'string',
    title: 'Default Log Level',
    description: 'The default logging level of the server.',
    required: false,
    sensitive: false,
  },
  DATASOURCE_CREDENTIALS: {
    includeInUserConfig: true,
    type: 'string',
    title: 'Datasource Credentials',
    description:
      'A JSON string that includes usernames and passwords for any datasources that require them. See the README for details on how to format this string.',
    required: false,
    sensitive: true,
  },
  INCLUDE_TOOLS: {
    includeInUserConfig: false,
    type: 'string',
    title: 'Included Tools',
    description:
      'A comma-separated list of tool names to include in the server. Only these tools will be available.',
    required: false,
    sensitive: false,
  },
  EXCLUDE_TOOLS: {
    includeInUserConfig: false,
    type: 'string',
    title: 'Excluded Tools',
    description:
      'A comma-separated list of tool names to exclude from the server. All other tools will be available.',
    required: false,
    sensitive: false,
  },
  INCLUDE_PROJECT_IDS: {
    includeInUserConfig: false,
    type: 'string',
    title: 'IDs of projects to constrain tool results by',
    description: 'A comma-separated list of project IDs to constrain tool results by.',
    required: false,
    sensitive: false,
  },
  INCLUDE_DATASOURCE_IDS: {
    includeInUserConfig: false,
    type: 'string',
    title: 'IDs of datasources to constrain tool results by',
    description: 'A comma-separated list of datasource IDs to constrain tool results by.',
    required: false,
    sensitive: false,
  },
  INCLUDE_WORKBOOK_IDS: {
    includeInUserConfig: false,
    type: 'string',
    title: 'IDs of workbooks to constrain tool results by',
    description: 'A comma-separated list of workbook IDs to constrain tool results by.',
    required: false,
    sensitive: false,
  },
  MAX_RESULT_LIMIT: {
    includeInUserConfig: false,
    type: 'number',
    title: 'Max Result Limit',
    description:
      'If a tool has a "limit" parameter and returns an array of items, the maximum length of that array.',
    required: false,
    sensitive: false,
  },
  DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION: {
    includeInUserConfig: false,
    type: 'boolean',
    title: 'Disable Query Datasource Filter Validation',
    description: 'Disable validation of SET and MATCH filter values in query-datasource tool.',
    required: false,
    sensitive: false,
  },
  DISABLE_METADATA_API_REQUESTS: {
    includeInUserConfig: false,
    type: 'boolean',
    title: 'Disable Metadata API Requests',
    description:
      'Disable requests to the Tableau Metadata API in the get-datasource-metadata tool.',
    required: false,
    sensitive: false,
  },
  SSL_KEY: {
    includeInUserConfig: false,
    type: 'string',
    title: 'SSL Key Path',
    description: 'The path to the SSL key file to use for the HTTP server.',
    required: false,
    sensitive: false,
  },
  SSL_CERT: {
    includeInUserConfig: false,
    type: 'string',
    title: 'SSL Certificate Path',
    description: 'The path to the SSL certificate file to use for the HTTP server.',
    required: false,
    sensitive: false,
  },
  HTTP_PORT_ENV_VAR_NAME: {
    includeInUserConfig: false,
    type: 'string',
    title: 'HTTP Port Environment Variable Name',
    description: 'The environment variable name to use for the HTTP server port.',
    required: false,
    sensitive: false,
  },
  CORS_ORIGIN_CONFIG: {
    includeInUserConfig: false,
    type: 'string',
    title: 'CORS Origin Config',
    description: 'The origin or origins to allow CORS requests from.',
    required: false,
    sensitive: false,
  },
  DISABLE_LOG_MASKING: {
    includeInUserConfig: false,
    type: 'boolean',
    title: 'Disable Log Masking',
    description: 'Disable masking of credentials in logs. For debug purposes only.',
    required: false,
    sensitive: false,
  },
} satisfies EnvVars;

const userConfig = Object.entries(envVars).reduce<Record<string, McpbUserConfigurationOption>>(
  (acc, [key, value]) => {
    if (value.includeInUserConfig) {
      acc[key.toLowerCase()] = {
        type: value.type,
        title: value.required ? value.title : `${value.title} (Optional)`,
        description: value.description,
        required: value.required,
        sensitive: value.sensitive,
      };
    }

    return acc;
  },
  {},
);

const manifestEnvObject = Object.entries(envVars).reduce<Record<string, string>>(
  (acc, [key, value]) => {
    if (value.includeInUserConfig) {
      acc[key] = `\${user_config.${key.toLowerCase()}}`;
    }
    return acc;
  },
  {},
);

const manifest = {
  manifest_version: '0.2',
  name: 'Tableau',
  version: packageJson.version,
  description: packageJson.description,
  author: {
    name: 'Tableau',
  },
  repository: {
    type: 'git',
    url: 'https://github.com/tableau/tableau-mcp',
  },
  homepage: packageJson.homepage,
  documentation: 'https://tableau.github.io/tableau-mcp/',
  license: packageJson.license,
  support: 'https://github.com/tableau/tableau-mcp/issues',
  icon: 'https://avatars.githubusercontent.com/u/828667',
  server: {
    type: 'node',
    entry_point: 'build/index.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/build/index.js'],
      env: manifestEnvObject,
    },
  },
  tools: toolNames.map((name) => ({ name })),
  user_config: userConfig,
} satisfies McpbManifest;

const manifestPath = join(__dirname, '../../manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`✅ Manifest file generated successfully at ${manifestPath}`);
