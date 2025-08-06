#!/usr/bin/env node
/* eslint-disable no-console */

import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import packageJson from '../../package.json' with { type: 'json' };
import { ProcessEnvEx } from '../../types/process-env.js';
import { toolNames } from '../tools/toolName.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type EnvVar<TTitle> = {
  type: 'string' | 'number' | 'boolean';
  title: TTitle;
  description: string;
  required: boolean;
  sensitive: boolean;
};

type EnvVars = {
  [TKey in keyof ProcessEnvEx]: EnvVar<TKey> & { includeInUserConfig: boolean };
};

type UserConfig = {
  [TKey in keyof ProcessEnvEx]: EnvVar<Lowercase<TKey>>;
};

type ManifestEnvObject = {
  [TKey in keyof ProcessEnvEx]: `\${user_config.${Lowercase<TKey>}}`;
};

const envVars = {
  SERVER: {
    includeInUserConfig: true,
    type: 'string',
    title: 'SERVER',
    description: 'The URL of the Tableau server.',
    required: true,
    sensitive: false,
  },
  SITE_NAME: {
    includeInUserConfig: true,
    type: 'string',
    title: 'SITE_NAME',
    description:
      'The name of the Tableau site to use. For Tableau Server, set this to an empty string to specify the default site.',
    required: true,
    sensitive: false,
  },
  PAT_NAME: {
    includeInUserConfig: true,
    type: 'string',
    title: 'PAT_NAME',
    description: 'The name of the Tableau Personal Access Token to use for authentication.',
    required: true,
    sensitive: false,
  },
  PAT_VALUE: {
    includeInUserConfig: true,
    type: 'string',
    title: 'PAT_VALUE',
    description: 'The value of the Tableau Personal Access Token to use for authentication.',
    required: true,
    sensitive: true,
  },
  TRANSPORT: {
    includeInUserConfig: false,
    type: 'string',
    title: 'TRANSPORT',
    description: 'The MCP transport type to use for the server.',
    required: false,
    sensitive: false,
  },
  DEFAULT_LOG_LEVEL: {
    includeInUserConfig: false,
    type: 'string',
    title: 'DEFAULT_LOG_LEVEL',
    description: 'The default logging level of the server.',
    required: false,
    sensitive: false,
  },
  DATASOURCE_CREDENTIALS: {
    includeInUserConfig: false,
    type: 'string',
    title: 'DATASOURCE_CREDENTIALS',
    description:
      'A JSON string that includes usernames and passwords for any datasources that require them.',
    required: false,
    sensitive: true,
  },
  INCLUDE_TOOLS: {
    includeInUserConfig: false,
    type: 'string',
    title: 'INCLUDE_TOOLS',
    description:
      'A comma-separated list of tool names to include in the server. Only these tools will be available.',
    required: false,
    sensitive: false,
  },
  EXCLUDE_TOOLS: {
    includeInUserConfig: false,
    type: 'string',
    title: 'EXCLUDE_TOOLS',
    description:
      'A comma-separated list of tool names to exclude from the server. All other tools will be available.',
    required: false,
    sensitive: false,
  },
  MAX_RESULT_LIMIT: {
    includeInUserConfig: false,
    type: 'number',
    title: 'MAX_RESULT_LIMIT',
    description:
      'If a tool has a "limit" parameter and returns an array of items, the maximum length of that array.',
    required: false,
    sensitive: false,
  },
  DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION: {
    includeInUserConfig: false,
    type: 'boolean',
    title: 'DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION',
    description: 'Disable validation of SET and MATCH filter values in query-datasource tool.',
    required: false,
    sensitive: false,
  },
  SSL_KEY: {
    includeInUserConfig: false,
    type: 'string',
    title: 'SSL_KEY',
    description: 'The path to the SSL key file to use for the HTTP server.',
    required: false,
    sensitive: false,
  },
  SSL_CERT: {
    includeInUserConfig: false,
    type: 'string',
    title: 'SSL_CERT',
    description: 'The path to the SSL certificate file to use for the HTTP server.',
    required: false,
    sensitive: false,
  },
  HTTP_PORT_ENV_VAR_NAME: {
    includeInUserConfig: false,
    type: 'string',
    title: 'HTTP_PORT_ENV_VAR_NAME',
    description: 'The environment variable name to use for the HTTP server port.',
    required: false,
    sensitive: false,
  },
  CORS_ORIGIN_CONFIG: {
    includeInUserConfig: false,
    type: 'string',
    title: 'CORS_ORIGIN_CONFIG',
    description: 'The origin or origins to allow CORS requests from.',
    required: false,
    sensitive: false,
  },
  DISABLE_LOG_MASKING: {
    includeInUserConfig: false,
    type: 'boolean',
    title: 'DISABLE_LOG_MASKING',
    description: 'Disable masking of credentials in logs. For debug purposes only.',
    required: false,
    sensitive: false,
  },
} satisfies EnvVars;

const userConfig = Object.entries(envVars).reduce<
  Record<string, Omit<EnvVar<string>, 'includeInUserConfig'>>
>((acc, [key, value]) => {
  if (value.includeInUserConfig) {
    acc[key] = {
      type: value.type,
      title: value.title.toLowerCase(),
      description: value.description,
      required: value.required,
      sensitive: value.sensitive,
    };
  }

  return acc;
}, {}) as UserConfig;

const manifestEnvObject = Object.entries(envVars).reduce<Record<string, string>>((acc, [key]) => {
  acc[key] = `\${user_config.${key.toLowerCase()}}`;
  return acc;
}, {}) as ManifestEnvObject;

// Create the manifest object
const manifest = {
  dxt_version: '0.1',
  name: packageJson.name,
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
};

const manifestPath = join(__dirname, '../../manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`✅ Manifest file generated successfully at ${manifestPath}`);
