import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { getTargetCompatibility } from '../scripts/platform.mjs';
import { resolveConfig } from '../scripts/safari.mjs';

const run = promisify(execFile);
const catalog = JSON.parse(await readFile(new URL('../webkit-versions.json', import.meta.url), 'utf8'));

test('Ventura cannot silently select the older revision for WebKit 18.4', () => {
  const result = getTargetCompatibility(catalog['18.4'], {
    platform: 'darwin', darwinRelease: '22.6.0',
  });
  assert.equal(result.available, false);
  assert.match(result.reason, /requires macOS 14/);
  for (const darwinRelease of ['23.6.0', '24.6.0', '25.0.0'])
    assert.equal(getTargetCompatibility(catalog['18.4'], { platform: 'darwin', darwinRelease }).available, true);
  assert.equal(getTargetCompatibility(catalog['18.0'], { platform: 'darwin', darwinRelease: '22.6.0' }).available, true);
});

test('minimum macOS catalog entries must be valid numbers', () => {
  for (const minimumMacOS of ['14', 0, 13.5])
    assert.throws(() => resolveConfig({ safariVersion: '18.4' }, {
      ...catalog, '18.4': { ...catalog['18.4'], minimumMacOS },
    }), /minimum macOS/);
});

test('terminal launcher checks the host before starting an application', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'safari-launcher-test-'));
  t.after(() => rm(folder, { recursive: true }));
  const bin = join(folder, 'bin');
  await mkdir(bin);
  for (const [name, source] of [
    ['uname', '#!/bin/sh\ncase "$1" in -s) echo "$SIM_TEST_SYSTEM";; -m) echo "$SIM_TEST_ARCH";; esac\n'],
    ['sw_vers', '#!/bin/sh\necho "$SIM_TEST_MACOS"\n'],
  ]) {
    await writeFile(join(bin, name), source);
    await chmod(join(bin, name), 0o755);
  }
  const launcher = join(folder, 'start.sh');
  await copyFile(new URL('../start.sh', import.meta.url), launcher);
  const app = join(folder, 'Safari Old Version Simulator.app');
  await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true });
  const executable = join(app, 'Contents', 'MacOS', 'Safari Old Version Simulator');
  await writeFile(executable, '#!/bin/sh\necho "app launched"\n');
  await chmod(executable, 0o755);
  const env = {
    ...process.env, PATH: bin + ':/usr/bin:/bin', SIM_TEST_SYSTEM: 'Darwin',
    SIM_TEST_ARCH: 'arm64', SIM_TEST_MACOS: '13.7.8',
  };
  for (const [overrides, message] of [
    [{ SIM_TEST_SYSTEM: 'Linux' }, /requires macOS 13/],
    [{ SIM_TEST_ARCH: 'x86_64' }, /Apple Silicon/],
    [{ SIM_TEST_MACOS: '12.7.6' }, /this Mac runs 12/],
  ]) {
    await assert.rejects(run('/bin/bash', [launcher, '--check'], {
      env: { ...env, ...overrides },
    }), error => error.code === 1 && message.test(error.stderr));
  }
  const { stdout } = await run('/bin/bash', [launcher, '--check'], { env });
  assert.match(stdout, /Ready:/);
  const launched = await run('/bin/bash', [launcher, '--app', app], { env });
  assert.match(launched.stdout, /app launched/);
});
