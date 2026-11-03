import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir, release } from 'node:os';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function resolveConfig(config, catalog) {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('Ayar dosyası bir JSON nesnesi olmalı.');
  if (typeof config.safariVersion !== 'string' ||
      !/^\d+\.\d+(?:\.0)?$/.test(config.safariVersion))
    throw new Error('safariVersion "16.4" veya "16.4.0" biçiminde olmalı. Safari yama sürümleri ayrı ayrı desteklenmiyor.');
  const family = config.safariVersion.replace(/^(\d+\.\d+)\.0$/, '$1');
  if (!Object.hasOwn(catalog, family))
    throw new Error('Desteklenmeyen sürüm: ' + config.safariVersion + '. Mevcut sürümler: ' + Object.keys(catalog).join(', '));
  const entry = catalog[family];
  if (!/^\d+\.\d+\.\d+$/.test(entry.playwrightVersion) ||
      !/^\d+\.\d+$/.test(entry.webkitVersion) ||
      (entry.webkitVersion !== family && entry.approximate !== true) || !/^\d+$/.test(entry.revision))
    throw new Error('WebKit sürüm kataloğundaki eşleme geçersiz.');
  const url = config.url ?? 'about:blank';
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('url geçerli bir adres olmalı.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) && url !== 'about:blank')
    throw new Error('url http://, https:// veya about:blank olmalı.');
  for (const key of ['headless', 'ignoreHTTPSErrors', 'allowApproximateVersion']) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean')
      throw new Error(key + ' true veya false olmalı.');
  }
  if (entry.approximate && config.allowApproximateVersion !== true)
    throw new Error('Safari ' + config.safariVersion + ' için ayrı bir Playwright WebKit derlemesi yok. Yaklaşık WebKit ' +
      entry.webkitVersion + ' kullanımı için allowApproximateVersion: true gerekli.');
  const viewport = config.viewport ?? { width: 1440, height: 900 };
  if (!viewport || !Number.isInteger(viewport.width) || !Number.isInteger(viewport.height) ||
      viewport.width < 1 || viewport.height < 1)
    throw new Error('viewport.width ve viewport.height pozitif tam sayılar olmalı.');
  return {
    safariVersion: config.safariVersion, family, ...entry, url, viewport,
    approximate: entry.approximate === true,
    allowApproximateVersion: config.allowApproximateVersion ?? false,
    headless: config.headless ?? false,
    ignoreHTTPSErrors: config.ignoreHTTPSErrors ?? false,
  };
}

export async function readConfig(configPath = join(root, 'safari.config.json')) {
  const [config, catalog] = await Promise.all([
    readFile(resolve(configPath), 'utf8'),
    readFile(join(root, 'webkit-versions.json'), 'utf8'),
  ]);
  return resolveConfig(JSON.parse(config), JSON.parse(catalog));
}

function warnApproximation(config) {
  if (config.approximate)
    console.warn('UYARI: Yaklaşık simülasyon. Safari ' + config.safariVersion +
      ' hedefi için WebKit ' + config.webkitVersion + ' kullanılacak; birebir Safari sürümü değildir.');
}

function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(command + ' başarısız: ' + (signal ?? code)));
    });
  });
}


async function installerNode() {
  if (process.env.SAFARI_INSTALL_NODE) {
    const binary = resolve(process.env.SAFARI_INSTALL_NODE);
    const { stdout } = await promisify(execFile)(binary, ['-p', 'process.versions.node']);
    if (![20, 22].includes(Number(stdout.trim().split('.')[0])))
      throw new Error('SAFARI_INSTALL_NODE bir Node 20 veya 22 çalıştırılabilir dosyası olmalı.');
    return binary;
  }
  if ([20, 22].includes(Number(process.versions.node.split('.')[0])))
    return process.execPath;
  const versionsDir = join(process.env.NVM_DIR ?? join(homedir(), '.nvm'), 'versions', 'node');
  let versions = [];
  try { versions = await readdir(versionsDir); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  versions = versions.filter(version => /^v(20|22)\./.test(version))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const binary = join(versionsDir, version, 'bin', 'node');
    try {
      const { stdout } = await promisify(execFile)(binary, ['-p', 'process.versions.node']);
      if ([20, 22].includes(Number(stdout.trim().split('.')[0]))) {
        console.log('Eski Playwright kurulumu için Node ' + stdout.trim() + ' kullanılıyor.');
        return binary;
      }
    } catch { /* Try another installed LTS runtime. */ }
  }
  throw new Error('Eski WebKit kurulumu için Node 20/22 gerekli. "nvm install 22 && nvm use 22" çalıştır veya SAFARI_INSTALL_NODE ile Node 22 yolunu belirt.');
}

export function patchMacSandboxProfile(source) {
  if (/\bSYS_ulock_wait2\b/.test(source)) return source;
  if (!/\b(?:allow|deny) syscall-unix\b/.test(source)) return source;
  if (!/^([ \t]*)SYS_ulock_wait\s*$/m.test(source))
    throw new Error('WebKit profilinde beklenen ulock_wait izni bulunamadı.');
  return source.replace(/^([ \t]*)SYS_ulock_wait([ \t]*)$/m, '$&\n$1SYS_ulock_wait2');
}

async function ensureMacCompatibility(webkit, config) {
  if (process.platform !== 'darwin' || Number(release().split('.')[0]) < 25 ||
      !config.webkitVersion.startsWith('15.')) return;
  const resources = join(dirname(webkit.executablePath()),
    'WebKit.framework', 'Versions', 'A', 'Resources');
  let changed = 0;
  for (const filename of ['com.apple.WebProcess.sb',
    'com.apple.WebKit.NetworkProcess.sb', 'com.apple.WebKit.GPUProcess.sb']) {
    const profilePath = join(resources, filename);
    const original = await readFile(profilePath, 'utf8');
    const updated = patchMacSandboxProfile(original);
    if (updated === original) continue;
    try { await copyFile(profilePath, profilePath + '.safari-simulator.original', constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await writeFile(profilePath, updated, 'utf8');
    changed++;
  }
  if (changed)
    console.log('macOS 26 uyumluluğu: ' + changed +
      ' WebKit 15 profiline ulock_wait2 izni eklendi; orijinaller yedeklendi.');
}

export async function prepareRuntime(config, onStatus = () => {}) {
  const runtimeRoot = resolve(process.env.SAFARI_RUNTIME_DIR ?? join(root, '.runtimes'));
  const runtime = join(runtimeRoot, 'playwright-' + config.playwrightVersion);
  const browsersPath = join(runtimeRoot, 'browsers');
  const packagePath = join(runtime, 'node_modules', 'playwright-core');
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath };
  // A caller-supplied platform override could silently select an unrelated binary.
  delete env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE;
  delete process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE;
  let installedVersion;
  try {
    installedVersion = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8')).version;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (installedVersion !== config.playwrightVersion) {
    await mkdir(runtime, { recursive: true });
    console.log('Playwright kuruluyor: ' + config.playwrightVersion);
    onStatus('Playwright ' + config.playwrightVersion + ' kuruluyor…');
    const bundledNpm = process.env.SAFARI_NPM_CLI;
    const npmCommand = bundledNpm ? await installerNode() :
      process.platform === 'win32' ? 'npm.cmd' : 'npm';
    await run(npmCommand, [
      ...(bundledNpm ? [resolve(bundledNpm)] : []),
      'install', '--prefix', runtime, '--save-exact', '--ignore-scripts',
      '--no-audit', '--no-fund', 'playwright-core@' + config.playwrightVersion,
    ], { cwd: runtimeRoot, env });
  }
  const manifest = JSON.parse(await readFile(join(packagePath, 'browsers.json'), 'utf8'));
  const webkitBuild = manifest.browsers.find(browser => browser.name === 'webkit');
  let declaredVersion = webkitBuild?.browserVersion;
  if (declaredVersion === undefined) {
    // Before Playwright 1.22, the version lives in the WebKit implementation.
    const implementation = await readFile(join(packagePath, 'lib', 'server', 'webkit', 'wkBrowser.js'), 'utf8');
    declaredVersion = implementation.match(/const BROWSER_VERSION = ['"]([0-9]+\.[0-9]+)['"]/)?.[1];
  }
  if (declaredVersion !== config.webkitVersion || webkitBuild?.revision !== config.revision)
    throw new Error('İndirilen Playwright paketinin WebKit eşlemesi katalogla uyuşmuyor.');
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  const require = createRequire(join(runtime, 'package.json'));
  const { webkit } = require('playwright-core');
  // browser.version() in old WebKit adapters is a constant, so verify the selected revision too.
  if (basename(dirname(webkit.executablePath())) !== 'webkit-' + config.revision)
    throw new Error('Bu işletim sistemi seçilen WebKit revision yerine başka bir derleme gerektiriyor.');
  let needsInstall = false;
  try { await access(webkit.executablePath(), constants.X_OK); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    needsInstall = true;
  }
  if (needsInstall) {
    console.log('WebKit ' + config.webkitVersion + ' indiriliyor...');
    onStatus('WebKit ' + config.webkitVersion + ' indiriliyor…');
    const node = await installerNode();
    // Historical installers treat an existing, partially extracted directory as complete.
    const browserDirectory = dirname(webkit.executablePath());
    try {
      await access(browserDirectory);
      await rename(browserDirectory, join(runtimeRoot,
        'incomplete-' + basename(browserDirectory) + '-' + Date.now()));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const packageInfo = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8'));
    const cli = typeof packageInfo.bin === 'string' ? packageInfo.bin :
      packageInfo.bin?.['playwright-core'] ?? packageInfo.bin?.playwright;
    if (!cli) throw new Error('Playwright paketinin kurulum komutu bulunamadı.');
    await run(node, [join(packagePath, cli), 'install', 'webkit'], { cwd: runtimeRoot, env });
    try { await access(webkit.executablePath(), constants.X_OK); }
    catch {
      throw new Error('WebKit kurulumu tamamlanamadı: çalıştırılabilir dosya eksik. Node 22 ile yeniden dene.');
    }
  }
  await ensureMacCompatibility(webkit, config);
  onStatus('WebKit ' + config.webkitVersion + ' hazır.');
  return webkit;
}

async function openResolvedSafari(config, overrides) {
  warnApproximation(config);
  const webkit = await prepareRuntime(config, overrides.onStatus);
  const browser = await webkit.launch({ headless: overrides.headless ?? config.headless });
  try {
    if (browser.version() !== config.webkitVersion)
      throw new Error('Platformun açtığı WebKit ' + browser.version() +
        '; istenen ' + config.webkitVersion + '. Eski işletim sistemleri farklı derlemelere düşebilir.');
    const context = await browser.newContext({
      viewport: config.viewport, ignoreHTTPSErrors: config.ignoreHTTPSErrors,
    });
    const page = await context.newPage();
    if (!overrides.skipNavigation)
      await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return { browser, context, page, config };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// Reusable from other Playwright scripts. Always close browser in a finally block.
export async function openSafari(configPath, overrides = {}) {
  return openResolvedSafari(await readConfig(configPath), overrides);
}

// Desktop callers can select a version without writing a temporary config file.
export async function openSafariConfig(rawConfig, overrides = {}) {
  const catalog = JSON.parse(await readFile(join(root, 'webkit-versions.json'), 'utf8'));
  return openResolvedSafari(resolveConfig(rawConfig, catalog), overrides);
}

async function main() {
  const args = process.argv.slice(2);
  let configPath = join(root, 'safari.config.json');
  const modes = new Set();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config') {
      if (!args[i + 1] || args[i + 1].startsWith('--'))
        throw new Error('--config için bir dosya yolu gerekli.');
      configPath = resolve(args[++i]);
    } else if (['--check', '--install-only', '--smoke'].includes(args[i])) {
      modes.add(args[i]);
    } else {
      throw new Error('Bilinmeyen seçenek: ' + args[i]);
    }
  }
  if (modes.size > 1) throw new Error('Bir çalıştırma modu seçmelisin.');
  const config = await readConfig(configPath);
  console.log('Safari hedefi: ' + config.safariVersion +
    ' → Playwright ' + config.playwrightVersion +
    ' / WebKit ' + config.webkitVersion + ' / revision ' + config.revision);
  console.log('Bu, Safari uygulaması yerine Playwright WebKit simülasyonudur.');
  if (modes.has('--check')) {
    warnApproximation(config);
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  if (modes.has('--install-only')) {
    warnApproximation(config);
    await prepareRuntime(config);
    console.log('WebKit hazır.');
    return;
  }
  const smoke = modes.has('--smoke');
  const { browser, page } = await openSafari(configPath, {
    ...(smoke ? { headless: true, skipNavigation: true } : {}),
  });
  const close = () => { void browser.close(); };
  page.once('close', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  try {
    console.log('Çalışan WebKit: ' + browser.version());
    if (smoke) {
      await page.setContent('<main id="probe">WebKit çalışıyor</main>');
      const result = await page.evaluate(() => ({
        text: document.querySelector('#probe').textContent,
        userAgent: navigator.userAgent,
        cssGrid: CSS.supports('display', 'grid'),
        javascript: [1, 2, 3].map(n => n * 2).join(','),
      }));
      if (result.text !== 'WebKit çalışıyor' || !result.cssGrid || result.javascript !== '2,4,6')
        throw new Error('WebKit smoke kontrolü başarısız.');
      console.log(JSON.stringify(result, null, 2));
      console.log('Smoke kontrolü başarılı.');
    } else {
      console.log('Adres: ' + config.url);
      console.log('Kapatmak için tarayıcı penceresini kapat veya Ctrl+C kullan.');
      if (browser.isConnected())
        await new Promise(done => browser.once('disconnected', done));
    }
  } finally {
    page.removeListener('close', close);
    process.removeListener('SIGINT', close);
    process.removeListener('SIGTERM', close);
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error('\nHata: ' + error.message);
    console.error('Kurulum/açılış hatalarında internet bağlantısını ve bu WebKit derlemesinin işletim sistemi uyumluluğunu kontrol et.');
    process.exitCode = 1;
  });
}
