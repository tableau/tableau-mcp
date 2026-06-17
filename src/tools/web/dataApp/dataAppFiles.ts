import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, UnknownError } from '../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { WebTool } from '../tool.js';
import {
  DataAppProjectFile,
  listDataAppProjectFiles,
  PROTECTED_DATA_APP_FILES,
  rejectPassthroughAuth,
  resolveAppFilePath,
} from './dataAppShared.js';

/**
 * File-lifecycle tools for data apps.
 *
 * These let an agent that has NO direct filesystem access (e.g. a sandboxed
 * web-chat agent talking to a local MCP server) author and inspect the app on
 * disk through the server. All paths are constrained to the app directory.
 */

const MAX_WRITE_BYTES = 1_000_000;
const MAX_READ_BYTES = 1_000_000;

// --- write-data-app-file ---------------------------------------------------

const writeParamsSchema = {
  appDir: z.string().nonempty().describe('Absolute path to the data app project directory.'),
  path: z
    .string()
    .nonempty()
    .describe(
      'File path relative to the app directory, e.g. "src/app.js". Parent dirs are created.',
    ),
  content: z.string().describe('Full file content to write (overwrites any existing file).'),
  allowProtected: z
    .boolean()
    .optional()
    .describe(
      'Allow overwriting toolchain-managed files (src/tableauData.js, server.js, dataapp.json). Defaults to false; only set this if you intentionally need to change generated plumbing.',
    ),
};

type WriteResult = {
  appDir: string;
  path: string;
  bytesWritten: number;
};

export const getWriteDataAppFileTool = (
  server: WebMcpServer,
): WebTool<typeof writeParamsSchema> => {
  const writeDataAppFileTool = new WebTool({
    server,
    name: 'write-data-app-file',
    description: `
Writes a file into a scaffolded data app project, creating parent directories as needed. This is how an agent without direct filesystem access places generated code (e.g. your src/app.js) into the project.

Paths are constrained to the app directory; absolute paths and ".." traversal are rejected. Toolchain-managed files (src/tableauData.js, server.js, dataapp.json) are protected — pass allowProtected: true only if you truly mean to change generated plumbing.

Typical flow: scaffold-data-app -> write-data-app-file (src/app.js, etc.) -> package-data-app -> deploy-data-app.`,
    paramsSchema: writeParamsSchema,
    annotations: {
      title: 'Write Data App File',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async ({ appDir, path, content, allowProtected }, extra): Promise<CallToolResult> => {
      return await writeDataAppFileTool.logAndExecute<WriteResult>({
        extra,
        args: { appDir, path, content, allowProtected },
        callback: async () => {
          const passthroughError = rejectPassthroughAuth(extra);
          if (passthroughError) {
            return passthroughError;
          }

          if (!(await isDir(appDir))) {
            return new ArgsValidationError(
              `appDir is not a directory: ${appDir}. Run scaffold-data-app first.`,
            ).toErr();
          }

          const resolved = resolveAppFilePath(appDir, path);
          if (!resolved) {
            return new ArgsValidationError(
              `path must stay within the app directory (no absolute paths or ".."): ${path}`,
            ).toErr();
          }

          if (!allowProtected && PROTECTED_DATA_APP_FILES.has(resolved.relPath)) {
            return new ArgsValidationError(
              `${resolved.relPath} is a toolchain-managed file. Do not rewrite it; build on the shim instead. Pass allowProtected: true to override.`,
            ).toErr();
          }

          const bytes = Buffer.byteLength(content, 'utf-8');
          if (bytes > MAX_WRITE_BYTES) {
            return new ArgsValidationError(
              `content is ${bytes} bytes; the limit is ${MAX_WRITE_BYTES}. Split large assets or fetch data at runtime.`,
            ).toErr();
          }

          try {
            await mkdir(dirname(resolved.absPath), { recursive: true });
            await writeFile(resolved.absPath, content, 'utf-8');
          } catch (error) {
            return new UnknownError(
              `Failed to write ${resolved.relPath}: ${getExceptionMessage(error)}`,
            ).toErr();
          }

          return new Ok<WriteResult>({
            appDir,
            path: resolved.relPath,
            bytesWritten: bytes,
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          content: [
            {
              type: 'text',
              text: `Wrote ${result.path} (${result.bytesWritten} bytes) to ${result.appDir}.`,
            },
          ],
        }),
      });
    },
  });

  return writeDataAppFileTool;
};

// --- read-data-app-file ----------------------------------------------------

const readParamsSchema = {
  appDir: z.string().nonempty().describe('Absolute path to the data app project directory.'),
  path: z
    .string()
    .nonempty()
    .describe('File path relative to the app directory, e.g. "src/app.js".'),
};

type ReadResult = {
  appDir: string;
  path: string;
  content: string;
};

export const getReadDataAppFileTool = (server: WebMcpServer): WebTool<typeof readParamsSchema> => {
  const readDataAppFileTool = new WebTool({
    server,
    name: 'read-data-app-file',
    description: `
Reads a file from a scaffolded data app project so the agent can inspect what is actually on disk (e.g. verify src/app.js after writing, or check server.js while debugging). Paths are constrained to the app directory.`,
    paramsSchema: readParamsSchema,
    annotations: {
      title: 'Read Data App File',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ appDir, path }, extra): Promise<CallToolResult> => {
      return await readDataAppFileTool.logAndExecute<ReadResult>({
        extra,
        args: { appDir, path },
        callback: async () => {
          const passthroughError = rejectPassthroughAuth(extra);
          if (passthroughError) {
            return passthroughError;
          }

          if (!(await isDir(appDir))) {
            return new ArgsValidationError(`appDir is not a directory: ${appDir}.`).toErr();
          }

          const resolved = resolveAppFilePath(appDir, path);
          if (!resolved) {
            return new ArgsValidationError(
              `path must stay within the app directory (no absolute paths or ".."): ${path}`,
            ).toErr();
          }

          let info;
          try {
            info = await stat(resolved.absPath);
          } catch {
            return new ArgsValidationError(`File not found: ${resolved.relPath}`).toErr();
          }
          if (!info.isFile()) {
            return new ArgsValidationError(`Not a file: ${resolved.relPath}`).toErr();
          }
          if (info.size > MAX_READ_BYTES) {
            return new ArgsValidationError(
              `${resolved.relPath} is ${info.size} bytes; the read limit is ${MAX_READ_BYTES}.`,
            ).toErr();
          }

          let content: string;
          try {
            content = await readFile(resolved.absPath, 'utf-8');
          } catch (error) {
            return new UnknownError(
              `Failed to read ${resolved.relPath}: ${getExceptionMessage(error)}`,
            ).toErr();
          }

          return new Ok<ReadResult>({ appDir, path: resolved.relPath, content });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          content: [{ type: 'text', text: result.content }],
        }),
      });
    },
  });

  return readDataAppFileTool;
};

// --- list-data-app-files ---------------------------------------------------

const listParamsSchema = {
  appDir: z.string().nonempty().describe('Absolute path to the data app project directory.'),
};

type ListResult = {
  appDir: string;
  files: DataAppProjectFile[];
};

export const getListDataAppFilesTool = (server: WebMcpServer): WebTool<typeof listParamsSchema> => {
  const listDataAppFilesTool = new WebTool({
    server,
    name: 'list-data-app-files',
    description: `
Lists the files in a scaffolded data app project (relative paths + sizes), skipping node_modules and .git. Use it to verify what is actually on disk before packaging or deploying, or while debugging a failed deploy.`,
    paramsSchema: listParamsSchema,
    annotations: {
      title: 'List Data App Files',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ appDir }, extra): Promise<CallToolResult> => {
      return await listDataAppFilesTool.logAndExecute<ListResult>({
        extra,
        args: { appDir },
        callback: async () => {
          const passthroughError = rejectPassthroughAuth(extra);
          if (passthroughError) {
            return passthroughError;
          }

          if (!(await isDir(appDir))) {
            return new ArgsValidationError(`appDir is not a directory: ${appDir}.`).toErr();
          }

          let files: DataAppProjectFile[];
          try {
            files = await listDataAppProjectFiles(appDir);
          } catch (error) {
            return new UnknownError(`Failed to list files: ${getExceptionMessage(error)}`).toErr();
          }

          return new Ok<ListResult>({ appDir, files });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          content: [
            {
              type: 'text',
              text:
                result.files.length === 0
                  ? `No files found in ${result.appDir}.`
                  : [
                      `${result.files.length} file(s) in ${result.appDir}:`,
                      ...result.files.map((f) => `  ${f.path} (${f.bytes} bytes)`),
                    ].join('\n'),
            },
          ],
        }),
      });
    },
  });

  return listDataAppFilesTool;
};

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}
