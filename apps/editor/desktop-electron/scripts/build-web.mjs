import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, '../../ui-react');
const pnpmExecPath = process.env.npm_execpath;
// `--watch` keeps vite rebuilding dist on every ui-react save, so the Tauri
// dev shell (which serves dist from disk, not the Vite dev server) picks up
// changes after a window reload. Release builds stay one-shot.
const watch = process.argv.includes('--watch');
const pnpmArgs = ['--dir', webDir, 'run', 'build'];
if (watch) {
  pnpmArgs.push('--watch');
}
const spawnEnv = {
  ...process.env,
  VITE_DESKTOP_RUNTIME: 'true'
};

function resolveCommand() {
  if (pnpmExecPath && /\.[cm]?js$/.test(pnpmExecPath)) {
    // pnpm installed as JS (npm, corepack, linux/macOS): run via node.
    return { cmd: process.execPath, args: [pnpmExecPath, ...pnpmArgs], shell: false };
  }
  if (pnpmExecPath) {
    // pnpm installed as native binary on Windows (pnpm.exe, pnpm.cmd):
    // execute directly — node cannot load .exe as an ESM module.
    return { cmd: pnpmExecPath, args: pnpmArgs, shell: process.platform === 'win32' };
  }
  // Fallback to pnpm resolved from PATH.
  return { cmd: 'pnpm', args: pnpmArgs, shell: process.platform === 'win32' };
}

const { cmd, args, shell } = resolveCommand();

if (!watch) {
  const result = spawnSync(cmd, args, {
    env: spawnEnv,
    stdio: 'inherit',
    shell
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} else {
  // Long-lived: stay up until Tauri (or the user) kills us, and mirror the
  // child's exit/signal so failures still fail the dev invocation.
  const child = spawn(cmd, args, {
    env: spawnEnv,
    stdio: 'inherit',
    shell
  });
  child.on('error', (error) => {
    throw error;
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 1);
    }
  });
}
