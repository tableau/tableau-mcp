import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import ExploreInTableauMethods from '../sdks/tableau/methods/exploreInTableauMethods.js';
import { Tool } from './tool.js';

export const exploreInTableauTool = new Tool({
  name: 'explore-in-tableau',
  description: `
Submit TDS (Tableau Data Source) content to Tableau's Explore in Tableau service and receive a redirect URL to an authoring session connected to the datasource.

**Purpose:**
This tool enables users to take TDS content and create an interactive Tableau authoring session through Tableau's analytics integration platform.

**Requirements:**
- TDS content as raw XML string
- Requires the following environment variables:
  - \`IA_API_KEY\`: API key for JWT signing
  - \`SALESFORCE_REGION\`: Salesforce region (defaults to 'us-east-1')

**Response:**
Returns a redirect URL that can be used to open the Tableau authoring session in a browser.

**Example Usage:**
Use this tool when you need to:
- Create an interactive Tableau workbook from TDS content
- Provide users with a direct link to explore data in Tableau
- Integrate Tableau authoring capabilities into external applications

**Note:** The API returns the redirect URL in response headers rather than the response body.
`,
  paramsSchema: {
    tdsContent: z.string().nonempty().describe('Raw TDS content as XML string'),
  },
  annotations: {
    title: 'Explore in Tableau',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ tdsContent }, { requestId }): Promise<CallToolResult> => {
    return await exploreInTableauTool.logAndExecute({
      requestId,
      args: { tdsContent },
      callback: async () => {
        const exploreInTableauMethods = new ExploreInTableauMethods();
        const result = await exploreInTableauMethods.exploreInTableau(tdsContent);
        return new Ok(result);
      },
    });
  },
});
