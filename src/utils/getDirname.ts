import { fileURLToPath } from 'url';

export function getDirname(): string {
  if (typeof __dirname === 'string') {
    return __dirname;
  }

  if (typeof import.meta !== 'undefined') {
    return fileURLToPath(new URL('.', import.meta.url));
  }

  throw new Error('Unable to determine directory path: neither __dirname nor import.meta is available');
}
