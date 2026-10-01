export const PRODUCTION_GUILD_ID = '1400610531189985310';
export function runtimeAllowed(config) {
  return (config.guildId === '1245112089647775877' && config.testMode === true) ||
    (config.guildId === PRODUCTION_GUILD_ID && config.testMode === false && config.productionApproved === true);
}
export function assertRuntime(config) {
  if (!runtimeAllowed(config)) throw Error('Runtime is not enabled for this server.');
}
