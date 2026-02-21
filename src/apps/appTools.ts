import { getEmbedTableauVizTool } from './embedTableauViz';
import { getPulseRendererAppTool } from './pulseRenderer';

export const appToolFactories = [getPulseRendererAppTool, getEmbedTableauVizTool];
