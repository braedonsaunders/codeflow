// GraphIR contract barrel — MOO-68 Commit 7.
//
// One import surface for every consumer (MOO-69/70/71 adapters, and this
// issue's own fixtures/example adapter) so nothing needs to know the
// individual module filenames making up the contract.
export * from './sourceCoordinate.js';
export * from './githubContext.js';
export * from './graphIR.js';
export * from './adapterResult.js';
export * from './navigation.js';
export * from './cacheKey.js';
