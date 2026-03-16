import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, '../../web');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const result = spawnSync(pnpmCommand, ['build'], {
  cwd: webDir,
  env: {
    ...process.env,
    VITE_READ_ONLY_MODE: 'true'
  },
  stdio: 'inherit'
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
