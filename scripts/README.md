# Scripts

This directory contains utility scripts for the Tableau MCP project.

## create-manifest.js

This script automatically generates the `manifest.json` file by reading various project files:

- **package.json**: Extracts name, version, description, homepage, and license
- **src/tools/toolName.ts**: Extracts all available MCP tool names
- **README.md**: Extracts environment variables from the "Required Environment Variables" and
  "Optional Environment Variables" sections

### Usage

```bash
npm run manifest
```

### Output

The script generates a `manifest.json` file in the project root with the following structure:

- `dxt_version`: Always set to "0.1"
- `name`, `version`, `description`, `homepage`, `license`: Copied from package.json
- `author.name`: Always set to "Tableau"
- `tools`: Array of all MCP tool names found in toolName.ts
- `user_config`: Object containing all environment variables with their metadata
- `server`: Server configuration with environment variable mappings

### Environment Variables

The script automatically detects:

- **Required variables**: SERVER, SITE_NAME, PAT_NAME, PAT_VALUE
- **Optional variables**: DEFAULT_LOG_LEVEL, DATASOURCE_CREDENTIALS, DISABLE_LOG_MASKING,
  INCLUDE_TOOLS, EXCLUDE_TOOLS, MAX_RESULT_LIMIT

The script also handles:

- **Sensitive flag**: Set to true if "(Sensitive)" appears in the description
- **Title formatting**: Converts variable names to user-friendly titles
- **Required flag**: Set based on which section the variable appears in
