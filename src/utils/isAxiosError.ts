import { isAxiosError } from '../../node_modules/axios/index.js';

// Our dependency on Axios is indirect through Zodios.
// Zodios doesn't re-export isAxiosError, so we need to import it haphazardly through node_modules.
// This re-export is only to prevent import clutter in the codebase.
export { isAxiosError };
