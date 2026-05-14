import { BaseConfig } from './config.shared.js';

export class Config extends BaseConfig {
  constructor() {
    super();

    if (this.transport !== 'stdio') {
      throw new Error('TRANSPORT must be "stdio" for Tableau Desktop authoring');
    }
  }
}

export const getDesktopConfig = (): Config => new Config();
