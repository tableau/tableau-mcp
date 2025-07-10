import { LoggingLevel, RequestId } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../server.js';
import { ToolName } from '../tools/toolName.js';
type Logger = 'rest-api' | (string & {});
type LogType = LoggingLevel | 'request' | 'response' | 'tool';
type LogMessage = {
  type: LogType;
  [key: string]: any;
};

const loggingLevels = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
] as const;

let currentLogLevel: LoggingLevel = 'debug';

export function isLoggingLevel(level: unknown): level is LoggingLevel {
  return !!loggingLevels.find((l) => l === level);
}

export const setLogLevel = (
  server: Server,
  level: LoggingLevel,
  { silent = false }: { silent?: boolean } = {},
): void => {
  if (currentLogLevel === level) {
    return;
  }

  currentLogLevel = level;

  if (!silent) {
    log.notice(server, `Logging level set to: ${level}`);
  }
};

export const log = {
  debug: getSendLoggingMessageFn('debug'),
  info: getSendLoggingMessageFn('info'),
  notice: getSendLoggingMessageFn('notice'),
  warning: getSendLoggingMessageFn('warning'),
  error: getSendLoggingMessageFn('error'),
  critical: getSendLoggingMessageFn('critical'),
  alert: getSendLoggingMessageFn('alert'),
  emergency: getSendLoggingMessageFn('emergency'),
} satisfies {
  [level in LoggingLevel]: (
    server: Server,
    message: string | LogMessage,
    logger: Logger,
  ) => Promise<void>;
};

export const shouldLogWhenLevelIsAtLeast = (level = currentLogLevel): boolean => {
  return loggingLevels.indexOf(level) >= loggingLevels.indexOf(currentLogLevel);
};

export const writeToStderr = (message: string): void => {
  if (process.env.TABLEAU_MCP_TEST === 'true') {
    // Silence logging when running in test mode
    return;
  }

  message = message.endsWith('\n') ? message : `${message}\n`;
  process.stderr.write(message);
};

export const getToolLogMessage = ({
  requestId,
  toolName,
  args,
}: {
  requestId: RequestId;
  toolName: ToolName;
  args: unknown;
}): LogMessage => {
  return {
    type: 'tool',
    requestId,
    tool: {
      name: toolName,
      ...(args !== undefined ? { args } : {}),
    },
  };
};

function getSendLoggingMessageFn(level: LoggingLevel) {
  return async (server: Server, message: string | LogMessage, logger: Logger = server.name) => {
    if (!shouldLogWhenLevelIsAtLeast(level)) {
      return;
    }

    return server.server.sendLoggingMessage({
      level,
      logger,
      message: JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          currentLogLevel,
          message,
        },
        null,
        2,
      ),
    });
  };
}
