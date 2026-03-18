import { BuildConfiguration, isBuildConfiguration } from './scripts/build';

class MetaEnv {
  buildConfiguration: BuildConfiguration;

  constructor() {
    this.buildConfiguration = isBuildConfiguration(import.meta.env.BUILD_CONFIGURATION)
      ? import.meta.env.BUILD_CONFIGURATION
      : 'default';
  }
}

export const getMetaEnv = (): MetaEnv => new MetaEnv();
