export function getDirname(): string {
  if (typeof __dirname === 'string') {
    return __dirname;
  }

  throw new Error('__dirname is not set');
}
