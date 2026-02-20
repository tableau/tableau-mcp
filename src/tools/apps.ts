import { registerPulseRendererApp } from '../apps/pulseRenderer';
import { Server } from '../server';

export type AppRegistrationFunction = (server: Server) => void;

export const appRegistrationFunctions: ReadonlyArray<AppRegistrationFunction> = [
  registerPulseRendererApp,
];
