import { existsSync } from 'fs';
import { join } from 'path';
import { Err, Ok, Result } from 'ts-results-es';

import { getDirname } from '../utils/getDirname';

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getLargeResultFilePath(
  fileResourceId: string,
): Result<{ fullFilePath: string }, { status: number; message: string }> {
  if (!uuidV4Regex.test(fileResourceId)) {
    return Err({ status: 400, message: 'Invalid file resource ID' });
  }

  const filePath = join(getDirname(), 'results', `${fileResourceId}.txt`);
  if (!existsSync(filePath)) {
    return Err({ status: 404, message: 'Result not found' });
  }

  return Ok({ fullFilePath: filePath });
}
