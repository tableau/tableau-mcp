#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';

import pkg from '../package.json';
import { getDesktopConfig } from './config.desktop.js';
import { getConfig } from './config.js';
import { initializeFeatureGate } from './features/init.js';
import { getTableauServerInfo } from './getTableauServerInfo.js';
import { FileLogger, setFileLogger } from './logging/fileLogger.js';
import { log } from './logging/logger.js';
import { isNotificationLevel, notifier, setNotificationLevel } from './logging/notification.js';
import { RestApi } from './sdks/tableau/restApi.js';
import { DesktopMcpServer } from './server.desktop.js';
import { startExpressServer } from './server/express.js';
import { resolveTransportProfile } from './transportProfile.js';

const serverVersion = pkg.version;

// The shipped tableau-mcp-desktop binary now serves BOTH profiles from one artifact,
// selected purely by TRANSPORT — so tab-agent-south can spawn the web/insights profile
// from the very same installed binary it launches for desktop authoring, without a
// second bundled artifact (Chiron insights "B1"):
//
//   TRANSPORT=stdio (default) -> desktop authoring profile: DesktopMcpServer over
//     stdio, driving the local Tableau Desktop via the External Client API. No
//     Tableau Server credentials.
//   TRANSPORT=http            -> web/insights profile: the Express server calling
//     Tableau Server/Cloud REST (OAuth or passthrough wg_session auth), mirroring the
//     http case of src/index.ts.
//
// stdio behaviour is unchanged for existing desktop consumers; http is additive.

async function startDesktopProfile(): Promise<void> {
  const config = getDesktopConfig();

  const notificationLevel = isNotificationLevel(config.defaultNotificationLevel)
    ? config.defaultNotificationLevel
    : 'debug';
  if (config.loggers.has('fileLogger')) {
    setFileLogger(
      new FileLogger({
        logDirectory: config.fileLoggerDirectory,
        fileNamePrefix: 'desktop-mcp-',
      }),
    );
  }

  const server = new DesktopMcpServer();
  await server.registerTools();
  await server.registerResources();
  server.mcpServer.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
    setNotificationLevel(server.mcpServer, request.params.level);
    return {};
  });

  const transport = new StdioServerTransport();
  await server.mcpServer.connect(transport);

  setNotificationLevel(server.mcpServer, notificationLevel);
  notifier.info(server.mcpServer, `${server.name} v${server.version} running on stdio`);
}

async function startWebProfile(): Promise<void> {
  const config = getConfig();

  RestApi.host = config.server;

  // Initialize feature gate provider
  initializeFeatureGate();

  // Start fetching server info immediately but don't block the port from opening.
  // Any failure here is fatal and logged explicitly -- no silent failures. The port
  // opens first so health checks can succeed, then we await this before declaring ready.
  const serverInfoReady = getTableauServerInfo(config.server).catch((error) => {
    log({
      message: 'Fatal error initializing server info',
      level: 'error',
      logger: 'startup',
      data: error,
    });
    process.exit(1);
  });

  const notificationLevel = isNotificationLevel(config.defaultNotificationLevel)
    ? config.defaultNotificationLevel
    : 'debug';
  if (config.loggers.has('fileLogger')) {
    setFileLogger(new FileLogger({ logDirectory: config.fileLoggerDirectory }));
  }

  const { url } = await startExpressServer({
    basePath: 'tableau-mcp',
    config,
    logLevel: notificationLevel,
  });

  // Port is now open. Wait for server info before logging the ready message.
  await serverInfoReady;

  if (!config.oauth.enabled) {
    log({
      message:
        '⚠️ TRANSPORT is "http" but OAuth is disabled! Your MCP server may not be protected from unauthorized access. Non-OAuth HTTP usage is intended only for testing/prototyping or deployments that are licensed and approved for user-based licensing (UBL). For general multi-user HTTP deployments, prefer OAuth. By explicitly disabling OAuth with DANGEROUSLY_DISABLE_OAUTH="true", confirm this matches your Tableau licensing/security guidance.',
      level: 'info',
      logger: 'startup',
    });
  }

  log({
    message: `tableau-mcp v${serverVersion} ${config.disableSessionManagement ? 'stateless ' : ''}streamable HTTP server available at ${url}`,
    level: 'info',
    logger: 'startup',
  });

  if (config.disableLogMasking) {
    log({ message: '⚠️ Log masking is disabled!', level: 'info', logger: 'startup' });
  }

  if (config.breakGlassDisableGlobally) {
    log({
      message:
        '⚠️ BREAK_GLASS_DISABLE_GLOBALLY is enabled! This means that the MCP server will be disabled globally and will return errors to all users!',
      level: 'info',
      logger: 'startup',
    });
  }
}

async function startServer(): Promise<void> {
  dotenv.config();
  // Profile is selected (and TRANSPORT validated) before any profile-specific config is
  // loaded: getDesktopConfig() requires stdio, getConfig() (web) requires SERVER/auth, so
  // we must not construct the wrong one — and an invalid transport must not fail open to
  // the HTTP path (see resolveTransportProfile).
  if (resolveTransportProfile(process.env.TRANSPORT) === 'desktop') {
    await startDesktopProfile();
  } else {
    await startWebProfile();
  }
}

startServer().catch((error) => {
  log({
    message: 'Fatal error when starting the server',
    level: 'error',
    logger: 'startup',
    data: error,
  });
  process.exit(1);
});
