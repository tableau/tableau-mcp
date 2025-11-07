#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import { z } from 'zod';

import { getConfig } from './config.js';
import { isLoggingLevel, log, setLogLevel, setServerLogger, writeToStderr } from './logging/log.js';
import { ServerLogger } from './logging/serverLogger.js';
import { Server, serverName, serverVersion } from './server.js';
import { startExpressServer } from './server/express.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

async function startServer(): Promise<void> {
  dotenv.config();
  const config = getConfig();

  const logLevel = isLoggingLevel(config.defaultLogLevel) ? config.defaultLogLevel : 'debug';
  if (config.enableServerLogging) {
    setServerLogger(new ServerLogger({ logDirectory: config.serverLogDirectory }));
  }

  switch (config.transport) {
    case 'stdio': {
      const server = new Server();
      server.registerTools();
      server.registerRequestHandlers();

      server.registerResource(
        'hello-world-widget',
        'ui://widget/hello-world.html',
        {},
        async () => ({
          contents: [
            {
              uri: 'ui://widget/hello-world.html',
              mimeType: 'text/html+skybridge',
              text: `
<div id="hello-world-root">
  <script type="module">
    import 'https://public.tableau.com/javascripts/api/tableau.embedding.3.latest.js';
  </script>
  <tableau-viz src="https://public.tableau.com/views/DeveloperSuperstore/Overview" debug width="100%" height="600"></tableau-viz>
</div>
`.trim(),
              _meta: {
                /* 
                  Renders the widget within a rounded border and shadow. 
                  Otherwise, the HTML is rendered full-bleed in the conversation
                */
                'openai/widgetPrefersBorder': true,

                /* 
                  Assigns a subdomain for the HTML. 
                  When set, the HTML is rendered within `chatgpt-com.web-sandbox.oaiusercontent.com`
                  It's also used to configure the base url for external links.
                */
                'openai/widgetDomain': 'https://chatgpt.com',

                /*
                  Required to make external network requests from the HTML code. 
                  Also used to validate `openai.openExternal()` requests. 
                */
                'openai/widgetCSP': {
                  // Maps to `connect-src` rule in the iframe CSP
                  connect_domains: ['https://chatgpt.com'],
                  // Maps to style-src, style-src-elem, img-src, font-src, media-src etc. in the iframe CSP
                  resource_domains: ['https://*.oaistatic.com'],
                },
              },
            },
          ],
        }),
      );

      server.registerTool(
        'hello-world',
        {
          title: 'Show Hello World',
          _meta: {
            // associate this tool with the HTML template
            'openai/outputTemplate': 'ui://widget/hello-world.html',
            // labels to display in ChatGPT when the tool is called
            'openai/toolInvocation/invoking': 'Displaying the hello world',
            'openai/toolInvocation/invoked': 'Displayed the hello world',
          },
          inputSchema: { message: z.string() },
        },
        async ({ message }) => {
          return {
            content: [{ type: 'text', text: 'Displayed the hello world!' }],
            structuredContent: {
              message,
            },
          };
        },
      );

      const transport = new StdioServerTransport();
      await server.connect(transport);

      setLogLevel(server, logLevel);
      log.info(server, `${server.name} v${server.version} running on stdio`);
      break;
    }
    case 'http': {
      const { url } = await startExpressServer({ basePath: serverName, config, logLevel });

      // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
      console.log(
        `${serverName} v${serverVersion} stateless streamable HTTP server available at ${url}`,
      );
      break;
    }
  }

  if (config.disableLogMasking) {
    writeToStderr('Log masking is disabled!');
  }
}

try {
  await startServer();
} catch (error) {
  writeToStderr(`Fatal error when starting the server: ${getExceptionMessage(error)}`);
  process.exit(1);
}
