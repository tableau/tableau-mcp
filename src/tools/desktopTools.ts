import { ZodRawShape } from 'zod';

import { ProductVersion } from '../sdks/tableau/types/serverInfo';
import { Server } from '../server';
import { Tool } from './tool';

// TODO: This type is only necessary while the desktopToolFactories array is empty.
// Once we have tools for the desktop, we can let TypeScript infer the type from its elements.
type ToolFactory<Args extends ZodRawShape | undefined = undefined> = (
  server: Server,
  productVersion: ProductVersion,
) => Tool<Args>;

export const toolFactories: ReadonlyArray<ToolFactory<any>> = [];
