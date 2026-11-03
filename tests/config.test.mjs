import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveConfig, readConfig, openSafariConfig, patchMacSandboxProfile } from '../scripts/safari.mjs';

const catalog = JSON.parse(await readFile(new URL('../webkit-versions.json', import.meta.url), 'utf8'));
test('16.4.0 selects the pinned 16.4 WebKit instead of the latest engine', () => {
  const config = resolveConfig({ safariVersion: '16.4.0' }, catalog);
  assert.equal(config.playwrightVersion, '1.32.1');
  assert.equal(config.webkitVersion, '16.4');
  assert.equal(config.revision, '1811');
});
test('switching the configured version selects a different runtime', () => {
  assert.equal(resolveConfig({ safariVersion: '18.0' }, catalog).playwrightVersion, '1.48.2');
});
test('unsupported versions and Safari patch versions cannot silently fall back', () => {
  for (const safariVersion of ['16.4.1', '16.5.0', 'latest', 16.4, '__proto__']) {
    assert.throws(() => resolveConfig({ safariVersion }, catalog));
  }
});
test('rejects malformed browser options before installing anything', () => {
  for (const options of [
    { headless: 'false' }, { ignoreHTTPSErrors: 1 }, { url: 'localhost:3000' },
    { url: 'javascript:alert(1)' }, { viewport: { width: -1, height: 900 } },
  ]) assert.throws(() => resolveConfig({ safariVersion: '16.4', ...options }, catalog));
});
test('loads the project config from disk', async () => {
  const config = await readConfig();
  assert.equal(config.playwrightVersion, catalog[config.family].playwrightVersion);
  assert.equal(typeof config.headless, 'boolean');
});

test('desktop launch input is validated before installing a runtime', async () => {
  await assert.rejects(
    openSafariConfig({ safariVersion: '15.6', url: 'about:blank' }),
    /allowApproximateVersion/,
  );
  await assert.rejects(
    openSafariConfig({ safariVersion: '16.4', url: 'file:///tmp/test' }),
    /url http:/,
  );
});

test('Safari 15 families select historical engines with their own revisions', () => {
  for (const [family, version, revision] of [
    ['15.0', '1.15.2', '1550'], ['15.4', '1.23.4', '1668'],
  ]) {
    for (const safariVersion of [family, family + '.0']) {
      const config = resolveConfig({ safariVersion }, catalog);
      assert.equal(config.playwrightVersion, version);
      assert.equal(config.webkitVersion, family);
      assert.equal(config.revision, revision);
    }
  }
});

test('approximate Safari 15 targets require explicit opt-in and keep the real engine version', () => {
  for (const [target, engine] of [
    ['15.1', '15.0'], ['15.2', '15.0'], ['15.3', '15.0'],
    ['15.5', '15.4'], ['15.6', '15.4'],
  ]) {
    assert.throws(() => resolveConfig({ safariVersion: target }, catalog), /allowApproximateVersion/);
    assert.throws(() => resolveConfig({ safariVersion: target, allowApproximateVersion: false }, catalog));
    const config = resolveConfig({ safariVersion: target + '.0', allowApproximateVersion: true }, catalog);
    assert.equal(config.webkitVersion, engine);
    assert.equal(config.approximate, true);
    assert.equal(config.playwrightVersion, catalog[engine].playwrightVersion);
  }
});
test('approximation cannot accept arbitrary versions or spoof Safari patches', () => {
  for (const safariVersion of ['15.9', '15.6.1']) {
    assert.throws(() => resolveConfig({ safariVersion, allowApproximateVersion: true }, catalog));
  }
  assert.throws(() => resolveConfig({ safariVersion: '15.6', allowApproximateVersion: 'true' }, catalog));
  assert.equal(resolveConfig({ safariVersion: '15.4' }, catalog).approximate, false);
});

test('macOS 26 compatibility adds only the missing locking syscall and is idempotent', () => {
  const original = '(allow syscall-unix (syscall-number\n        SYS_ulock_wait\n        SYS_ulock_wake))';
  const updated = patchMacSandboxProfile(original);
  assert.equal(updated, original.replace('SYS_ulock_wait\n', 'SYS_ulock_wait\n        SYS_ulock_wait2\n'));
  assert.equal(patchMacSandboxProfile(updated), updated);
  assert.throws(() => patchMacSandboxProfile('(deny syscall-unix)'), /ulock_wait/);
});

test('old profiles with existing locking permission or no syscall filter stay unchanged', () => {
  for (const source of ['(allow syscall-unix (syscall-number SYS_ulock_wait2))', '(deny default)'])
    assert.equal(patchMacSandboxProfile(source), source);
});
