import { release } from 'node:os';

export function getTargetCompatibility(entry, host = {}) {
  const platform = host.platform ?? process.platform;
  const darwinRelease = host.darwinRelease ?? release();
  if (platform !== 'darwin' || entry.minimumMacOS === undefined)
    return { available: true };
  const macOSMajor = Number(darwinRelease.split('.')[0]) - 9;
  if (macOSMajor >= entry.minimumMacOS) return { available: true };
  return {
    available: false,
    reason: 'WebKit ' + entry.webkitVersion + ' requires macOS ' +
      entry.minimumMacOS + ' or later. This Mac runs macOS ' + macOSMajor + '.',
  };
}
