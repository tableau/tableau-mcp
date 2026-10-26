import { randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Err, Ok, Result } from 'ts-results-es';

import { McpToolError } from '../errors/mcpToolError.js';
import { copyPackageTree, replaceLiteral, replaceTokensInTree } from './packageFiles.js';

export type RetargetedDataApp = {
  sourceDir: string;
  packageId: string;
};

export async function retargetDataAppPackage(args: {
  sourceDir: string;
  destinationRoot: string;
  extensionsDatasourceId: string;
  fieldReplacements?: Array<{ find: string; replace: string }>;
}): Promise<Result<RetargetedDataApp, McpToolError>> {
  try {
    const manifest = JSON.parse(await readFile(join(args.sourceDir, 'manifest.json'), 'utf8')) as {
      id?: unknown;
    };
    if (typeof manifest.id !== 'string' || !manifest.id) {
      throw new Error('Source package manifest has no id.');
    }
    const sourceBefore = await readFile(join(args.sourceDir, 'manifest.json'), 'utf8');
    const packageId = `${manifest.id}.retarget.${randomBytes(3).toString('hex')}`;
    const destination = resolve(args.destinationRoot, packageId);
    await copyPackageTree(args.sourceDir, destination);
    await replaceTokensInTree(destination, (_relativePath, text) => {
      let next = replaceLiteral(text, manifest.id as string, packageId);
      next = next.replace(/var BOUND_DATASOURCE_ID = (?:'[^']*'|"[^"]*"|'');/, () => {
        return `var BOUND_DATASOURCE_ID = ${JSON.stringify(args.extensionsDatasourceId)};`;
      });
      for (const replacement of args.fieldReplacements ?? []) {
        if (!replacement.find || replacement.find.includes('..')) continue;
        next = replaceLiteral(next, replacement.find, replacement.replace);
      }
      return next;
    });
    const sourceAfter = await readFile(join(args.sourceDir, 'manifest.json'), 'utf8');
    if (sourceAfter !== sourceBefore) {
      throw new Error('Retarget changed the source package.');
    }
    return new Ok({ sourceDir: destination, packageId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Err(
      new McpToolError({
        type: 'data-app-retarget-rejected',
        message,
        statusCode: 400,
      }),
    );
  }
}
