import { readFileSync } from 'fs';
import { join } from 'path';

import { getDirname } from '../utils/getDirname';

type AppName = 'pulse-renderer';

type App = {
  name: AppName;
  resourceUri: `ui://tableau-mcp/${AppName}.html`;
  html: string;
};

export const getAppDetails = (name: AppName): App => {
  return {
    name,
    resourceUri: `ui://tableau-mcp/${name}.html`,
    html: readFileSync(join(getDirname(), 'web', `${name}.html`), 'utf-8'),
  };
};
