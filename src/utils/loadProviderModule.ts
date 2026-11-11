import { createRequire } from 'node:module';

import { runningAsSea } from './sea.js';

export function loadProviderModule(
  modulePath: string,
  callerRequire: NodeJS.Require,
): ReturnType<NodeJS.Require> {
  const moduleRequire = runningAsSea() ? createRequire(process.execPath) : callerRequire;
  return moduleRequire(modulePath);
}
