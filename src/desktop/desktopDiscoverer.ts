import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';

import { log } from '../logging/logger';
import { DesktopInstance, desktopInstanceMetadataSchema } from './desktopInstance';

const manifestSchema = z.object({
  instances: z.array(desktopInstanceMetadataSchema),
});

export type DesktopInstanceManifest = z.infer<typeof manifestSchema>;

export class DesktopDiscoverer {
  getInstances(): Map<number, DesktopInstance> {
    const manifestPath = getManifestPath();
    if (!existsSync(manifestPath)) {
      return new Map();
    }

    try {
      const content = readFileSync(manifestPath, 'utf8');
      const manifest = manifestSchema.parse(JSON.parse(content));
      return new Map(
        manifest.instances.map((instance) => [instance.pid, new DesktopInstance(instance)]),
      );
    } catch (error) {
      log({
        message: 'Failed to read manifest',
        level: 'error',
        logger: 'DesktopDiscoverer',
        data: error,
      });
      return new Map();
    }
  }

  getInstance(pid: number): DesktopInstance {
    const instances = this.getInstances();
    const instance = instances.get(pid);

    if (!instance) {
      throw new Error(`No Desktop instance found with PID ${pid}`);
    }

    return instance;
  }
}

function getManifestPath(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return join(localAppData, 'Tableau', 'Desktop', 'agent-manifest.json');
  }

  return join(homedir(), '.tableau', 'agent-manifest.json');
}
