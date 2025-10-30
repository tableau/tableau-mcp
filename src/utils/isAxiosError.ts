import { isAxiosError } from 'axios';

// Our dependency on Axios is indirect through Zodios.
// Zodios doesn't re-export isAxiosError, so we need to import it directly from axios.
// This re-export is only to prevent import clutter in the codebase.
export { isAxiosError };
