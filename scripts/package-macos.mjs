import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('Package this Apple Silicon release on an arm64 Mac.');

const appName = 'Safari Old Version Simulator.app';
const builtApp = join(root, 'dist', 'mac-arm64', appName);
const { stdout } = await run('/usr/libexec/PlistBuddy', [
  '-c', 'Print :CFBundleShortVersionString', join(builtApp, 'Contents', 'Info.plist'),
]);
if (stdout.trim() !== pkg.version)
  throw new Error('The app bundle version differs from package.json. Rebuild the app first.');

const name = 'Safari-Old-Version-Simulator-' + pkg.version + '-mac-arm64';
const folder = join(root, 'dist', name);
await mkdir(folder, { recursive: true });
await cp(builtApp, join(folder, appName), {
  recursive: true, force: true, preserveTimestamps: true, verbatimSymlinks: true,
});
await cp(join(root, 'start.sh'), join(folder, 'start.sh'));
await chmod(join(folder, 'start.sh'), 0o755);
await writeFile(join(folder, 'START-HERE.txt'), [
  'Safari Old Version Simulator ' + pkg.version,
  '',
  'Requirements: Apple Silicon Mac, macOS Ventura 13 or later.',
  'The application bundle includes Node.js and npm.',
  '',
  'Open Terminal, change to this extracted folder, and run:',
  '  ./start.sh',
  '',
  'Check requirements without opening a window:',
  '  ./start.sh --check',
  '',
  'You can keep Safari Old Version Simulator.app in Finder or move it to Applications.',
  'After moving it, launch from Terminal with:',
  '  ./start.sh --app "/Applications/Safari Old Version Simulator.app"',
  '',
  'Press Ctrl+C to quit the app and its browser.',
  'WebKit 18.4 requires macOS 14 or later; other engine compatibility varies by host.',
  'The first launch of each selected browser build needs an internet connection.',
  'This app is ad-hoc signed and not notarized. macOS may require approval to launch it.',
  '',
].join('\n'), 'utf8');

const zip = join(root, 'dist', name + '.zip');
const temporaryZip = zip + '.partial-' + process.pid;
await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', folder, temporaryZip]);
await rename(temporaryZip, zip);
const digest = createHash('sha256').update(await readFile(zip)).digest('hex');
await writeFile(zip + '.sha256', digest + '  ' + name + '.zip\n', 'utf8');
console.log('Packaged: ' + zip);
