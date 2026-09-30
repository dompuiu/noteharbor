import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @electron/rebuild (invoked by `electron-builder install-app-deps`) stamps every
// native module it rebuilds with build/<config>/.forge-meta containing "<arch>--<abi>".
// It skips any module whose stamp already matches the target ABI. The pnpm store is
// shared between the dev server (runs on Node) and the packaged app (runs on Electron),
// and tooling such as `pnpm run fix:sqlite:node` replaces the compiled binary without
// updating that stamp. The stamp then lies: the binary is a Node build while the stamp
// claims an Electron build, so packaging silently bundles the wrong binary.
//
// Clearing the stamps before `install-app-deps` forces @electron/rebuild to actually
// rebuild for Electron. Pass package names to limit which stamps are cleared, e.g.
// `node ./scripts/reset-native-stamps.mjs better-sqlite3`.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopDir = path.resolve(__dirname, '..');

const FORGE_META_FILENAME = '.forge-meta';
const onlyPackages = new Set(process.argv.slice(2));

function findWorkspaceRoot(startDir) {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (fs.existsSync(path.join(currentDir, 'pnpm-workspace.yaml'))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function listDirectory(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function collectInstalledPackages(nodeModulesDir) {
  const packages = [];

  for (const entry of listDirectory(nodeModulesDir)) {
    if (!entry.isDirectory()) {
      continue;
    }

    const entryPath = path.join(nodeModulesDir, entry.name);

    if (entry.name.startsWith('@')) {
      for (const scopedEntry of listDirectory(entryPath)) {
        if (scopedEntry.isDirectory()) {
          packages.push({ name: `${entry.name}/${scopedEntry.name}`, dir: path.join(entryPath, scopedEntry.name) });
        }
      }
      continue;
    }

    packages.push({ name: entry.name, dir: entryPath });
  }

  return packages;
}

function collectForgeMetaFiles(packageDir) {
  const buildDir = path.join(packageDir, 'build');
  const metaFiles = [];

  for (const entry of listDirectory(buildDir)) {
    if (!entry.isDirectory()) {
      continue;
    }

    const metaPath = path.join(buildDir, entry.name, FORGE_META_FILENAME);
    if (fs.existsSync(metaPath)) {
      metaFiles.push(metaPath);
    }
  }

  return metaFiles;
}

function main() {
  const workspaceRoot = findWorkspaceRoot(desktopDir);
  const rootDir = workspaceRoot ?? desktopDir;
  const storeDir = path.join(rootDir, 'node_modules', '.pnpm');

  if (!fs.existsSync(storeDir)) {
    console.log(`No pnpm store found at ${storeDir}; nothing to reset.`);
    return;
  }

  let removed = 0;

  for (const storeEntry of listDirectory(storeDir)) {
    if (!storeEntry.isDirectory()) {
      continue;
    }

    const packageNodeModulesDir = path.join(storeDir, storeEntry.name, 'node_modules');

    for (const packageInfo of collectInstalledPackages(packageNodeModulesDir)) {
      if (onlyPackages.size > 0 && !onlyPackages.has(packageInfo.name)) {
        continue;
      }

      for (const metaPath of collectForgeMetaFiles(packageInfo.dir)) {
        fs.rmSync(metaPath, { force: true });
        removed += 1;
        console.log(`Removed native rebuild stamp: ${path.relative(rootDir, metaPath).split(path.sep).join('/')}`);
      }
    }
  }

  console.log(removed > 0
    ? `Cleared ${removed} native rebuild stamp(s); Electron will rebuild them for the packaged app.`
    : 'No native rebuild stamps to clear.');
}

main();
