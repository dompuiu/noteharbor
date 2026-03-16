import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, '../../web');
const pnpmExecPath = process.env.npm_execpath;

if (!pnpmExecPath) {
  throw new Error('Could not determine pnpm executable path from npm_execpath.');
}

const result = spawnSync(process.execPath, [pnpmExecPath, '--dir', webDir, 'run', 'build'], {
  env: {
    ...process.env,
    VITE_READ_ONLY_MODE: 'true'
  },
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
