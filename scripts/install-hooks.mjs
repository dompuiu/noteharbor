// Install the shared-data post-checkout hook.
//
// Runs from `pnpm install` (package.json `prepare`) and is safe to run again.
// In a linked worktree `.git` is a file, so resolve the real hooks directory
// through Git rather than assuming `.git/hooks`.
//
// Kept in Node rather than `sh` so `pnpm install` works from PowerShell and
// cmd.exe, where `sh` may not be on PATH. Git for Windows runs the installed
// hook with its own bundled shell.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

let hooksDir;
try {
  // `--git-path` is relative to the repo root, or absolute.
  hooksDir = resolve(repoRoot, git(["rev-parse", "--git-path", "hooks"]));
} catch {
  // Not a Git checkout (e.g. an exported tarball): nothing to install.
  process.exit(0);
}

mkdirSync(hooksDir, { recursive: true });

const hookSource = join(repoRoot, "scripts", "post-checkout");
const hookTarget = join(hooksDir, "post-checkout");

// Replace whatever is there, matching the old `ln -sfn` behavior.
rmSync(hookTarget, { force: true });

if (process.platform === "win32") {
  // Creating symlinks on Windows usually needs Developer Mode or elevation, so
  // copy instead. Re-running `pnpm install` refreshes the copy.
  copyFileSync(hookSource, hookTarget);
} else {
  // Relative so the shared hook (one per clone, in the common git dir) keeps
  // resolving after the worktree that installed it is deleted.
  symlinkSync(relative(hooksDir, hookSource), hookTarget, "file");
  chmodSync(hookSource, 0o755);
}
