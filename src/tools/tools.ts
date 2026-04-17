import { toolFactories as desktopToolFactories } from './desktopTools';
import { toolFactories as webToolFactories } from './webTools';

export const toolFactories =
  import.meta.env.BUILD_MODE === 'desktop' ? desktopToolFactories : webToolFactories;
