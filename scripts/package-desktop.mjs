import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const desktop = path.join(root, 'desktop');
const bundle = path.join(desktop, 'bundle');
const NODE_VERSION = 'v22.21.0';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false, env: process.env });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? 'signal'})`);
  }
}

function nodePackage() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'win32') {
    const folder = `node-${NODE_VERSION}-win-${arch}`;
    return { file: `${folder}.zip`, folder, binary: 'node.exe' };
  }
  const os = process.platform === 'darwin' ? 'darwin' : 'linux';
  const folder = `node-${NODE_VERSION}-${os}-${arch}`;
  return { file: `${folder}.tar.gz`, folder, binary: path.join('bin', 'node') };
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${url} (${response.status})`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function copyStandalone() {
  rmSync(bundle, { recursive: true, force: true });
  const standalone = path.join(bundle, 'standalone');
  cpSync(path.join(root, '.next', 'standalone'), standalone, { recursive: true });
  cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true });
  cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
}

async function copyNode() {
  const spec = nodePackage();
  const cache = path.join(root, '.tmp-desktop');
  mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, spec.file);
  if (!existsFresh(archive)) {
    const url = `https://nodejs.org/dist/${NODE_VERSION}/${spec.file}`;
    console.log(`Downloading ${url}`);
    await download(url, archive);
  }
  const extracted = path.join(cache, 'node-extract');
  rmSync(extracted, { recursive: true, force: true });
  mkdirSync(extracted, { recursive: true });
  run('tar', ['-xf', archive, '-C', extracted], root);
  const nodeDir = path.join(bundle, 'node');
  mkdirSync(nodeDir, { recursive: true });
  const binaryName = process.platform === 'win32' ? 'node.exe' : 'node';
  cpSync(path.join(extracted, spec.folder, spec.binary), path.join(nodeDir, binaryName));
}

function existsFresh(file) {
  try {
    return statSync(file).size > 0;
  } catch {
    return false;
  }
}

function pack() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install'], {
    cwd: desktop,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status !== 0) throw new Error('npm install in desktop/ failed');
  const electronInstall = path.join(desktop, 'node_modules', 'electron', 'install.js');
  run(process.execPath, [electronInstall], desktop);
  const builder = path.join(desktop, 'node_modules', 'electron-builder', 'cli.js');
  const args =
    process.platform === 'win32'
      ? ['--win', 'portable', '--x64']
      : process.platform === 'darwin'
        ? ['--mac', 'zip', '--arm64', '--x64']
        : ['--linux', 'AppImage'];
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  const built = spawnSync(process.execPath, [builder, ...args], {
    cwd: desktop,
    stdio: 'inherit',
    env,
  });
  if (built.status !== 0) throw new Error(`electron-builder failed (${built.status})`);
}

async function embedWindowsIcon() {
  if (process.platform !== 'win32') return;
  const cache = path.join(root, '.tmp-desktop');
  mkdirSync(cache, { recursive: true });
  const rcedit = path.join(cache, 'rcedit-x64.exe');
  if (!existsFresh(rcedit)) {
    await download('https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe', rcedit);
  }
  const unpacked = path.join(root, 'dist-desktop', 'win-unpacked');
  run(rcedit, [path.join(unpacked, 'TeamLeadDashboard.exe'), '--set-icon', path.join(desktop, 'icon.ico')], root);
  const builder = path.join(desktop, 'node_modules', 'electron-builder', 'cli.js');
  const built = spawnSync(
    process.execPath,
    [builder, '--prepackaged', unpacked, '--win', 'portable', '--x64'],
    { cwd: desktop, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } },
  );
  if (built.status !== 0) throw new Error(`icon repack failed (${built.status})`);
}

console.log('Building the Next.js app');
run(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], root);
copyStandalone();
await copyNode();
pack();
await embedWindowsIcon();
console.log('Desktop build is in dist-desktop/');
