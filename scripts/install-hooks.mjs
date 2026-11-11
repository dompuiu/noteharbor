// Install the shared-data post-checkout hook.
//
// Runs from `pnpm install` (package.json `prepare`) and is safe to run again.
// In a linked worktree `.git` is a file, so resolve the real hooks directory
// through Git rather than assuming `.git/hooks`.
//
// The hook is shared by every worktree in the clone, but the script it runs
// must live in the primary checkout: worktrees are short-lived, so a link into
// one of them dangles as soon as that worktree is removed.
//
// Kept in Node rather than `sh` so `pnpm install` works from PowerShell and
// cmd.exe, where `sh` may not be on PATH. Git for Windows runs the installed
// hook with its own bundled shell.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
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
let primaryRoot;
try {
  // `--git-path` is relative to the repo root, or absolute.
  hooksDir = resolve(repoRoot, git(["rev-parse", "--git-path", "hooks"]));
  // `git worktree list` starts with the primary worktree, even when run from a
  // linked one.
  const firstWorktree = git(["worktree", "list", "--porcelain"])
    .split("\n")
    .find((line) => line.startsWith("worktree "));
  primaryRoot = firstWorktree
    ? firstWorktree.slice("worktree ".length)
    : repoRoot;
} catch {
  // Not a Git checkout (e.g. an exported tarball): nothing to install.
  process.exit(0);
}

mkdirSync(hooksDir, { recursive: true });

// Prefer the primary checkout's copy so the shared hook survives the worktree
// that happens to run `pnpm install` being deleted.
const primarySource = join(primaryRoot, "scripts", "post-checkout");
const hookSource = exists(primarySource)
  ? primarySource
  : join(repoRoot, "scripts", "post-checkout");
const hookTarget = join(hooksDir, "post-checkout");

chmodSync(hookSource, 0o755);

// Self-heal: a previous run may have left the hook missing or pointing at a
// deleted worktree, which makes Git skip it silently. Only touch it when it
// does not already resolve to the right script.
if (!resolvesTo(hookTarget, hookSource)) {
  rmSync(hookTarget, { force: true });

  if (process.platform === "win32") {
    // Creating symlinks on Windows usually needs Developer Mode or elevation,
    // so copy instead. Re-running `pnpm install` refreshes the copy.
    copyFileSync(hookSource, hookTarget);
  } else {
    // Relative so the shared hook (one per clone, in the common git dir)
    // survives the checkout directory being moved.
    symlinkSync(relative(hooksDir, hookSource), hookTarget, "file");
  }
}

function exists(path) {
  try {
    realpathSync(path);
    return true;
  } catch {
    return false;
  }
}

function resolvesTo(path, source) {
  try {
    return realpathSync(path) === realpathSync(source);
  } catch {
    // Missing target, dangling symlink, or a stale copy.
    return false;
  }
}
