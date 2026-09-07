import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, '../../web');
const pnpmExecPath = process.env.npm_execpath;
const pnpmArgs = ['--dir', webDir, 'run', 'build'];
const spawnEnv = {
  ...process.env,
  VITE_DESKTOP_RUNTIME: 'true'
};

let result;
if (pnpmExecPath && /\.[cm]?js$/.test(pnpmExecPath)) {
  // pnpm installed as JS (npm, corepack, linux/macOS): run via node.
  result = spawnSync(process.execPath, [pnpmExecPath, ...pnpmArgs], {
    env: spawnEnv,
    stdio: 'inherit'
  });
} else if (pnpmExecPath) {
  // pnpm installed as native binary on Windows (pnpm.exe, pnpm.cmd):
  // execute directly — node cannot load .exe as an ESM module.
  result = spawnSync(pnpmExecPath, pnpmArgs, {
    env: spawnEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
} else {
  // Fallback to pnpm resolved from PATH.
  result = spawnSync('pnpm', pnpmArgs, {
    env: spawnEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
}

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
