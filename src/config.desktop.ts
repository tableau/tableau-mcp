import { removeClaudeMcpBundleUserConfigTemplates } from './config.shared';

export class Config {
  constructor() {
    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates(process.env);
    const { _ } = cleansedVars;
  }
}

export const getDesktopConfig = (): Config => new Config();

export const exportedForTesting = {
  Config,
};
