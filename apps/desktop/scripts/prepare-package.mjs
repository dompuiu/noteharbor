import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopDir = path.resolve(__dirname, '..');
const serverSrcDir = path.resolve(__dirname, '../../server/src');
const webDistDir = path.resolve(__dirname, '../../web/dist');
const buildDir = path.join(desktopDir, '.build');
const buildServerDir = path.join(buildDir, 'server', 'src');
const buildWebDir = path.join(buildDir, 'web-dist');

if (!fs.existsSync(webDistDir)) {
  throw new Error('Web build output is missing. Run the web build before packaging Electron.');
}

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(buildServerDir), { recursive: true });
fs.cpSync(serverSrcDir, buildServerDir, { recursive: true });
fs.cpSync(webDistDir, buildWebDir, { recursive: true });
