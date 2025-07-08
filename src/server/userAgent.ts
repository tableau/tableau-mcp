import pkg from '../../package.json' with { type: 'json' };

export const userAgent = `${pkg.name}/${pkg.version}`;
