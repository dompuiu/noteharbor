#!/usr/bin/env node
// Starts the Rust API and the Vite UI for development.
//
// Several Editor instances may run at once (one per Git worktree). The API
// prefers `PORT` (default 3002) but falls back to an ephemeral port when that
// port is taken, so this script reads the port the server actually bound and
// hands it to Vite through `NOTE_HARBOR_API_PORT`. Vite keeps its own
// automatic port pick (5173, 5174, ...).

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const isWindows = process.platform === "win32";
// Only forward PORT when the caller pinned one; otherwise the server uses its
// default (3002) and is free to fall back to an ephemeral port when busy.
const pinnedPort = process.env.PORT?.trim() || null;

const children = new Set();
let shuttingDown = false;
let apiPort = null;

function start(command, args, { env = {}, stdio = "inherit" } = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio,
    // pnpm is a .cmd shim on Windows; a shell resolves it.
    shell: isWindows,
    // Own process group on POSIX so the whole tree can be signalled.
    detached: !isWindows,
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = code;
  for (const child of children) killTree(child);
  // Do not hang forever on a child that ignores SIGTERM.
  setTimeout(() => process.exit(code), 2000).unref();
}

const server = start("cargo", ["run", "-p", "editor_server_rust"], {
  env: pinnedPort ? { PORT: pinnedPort } : {},
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.pipe(process.stderr);

const lines = createInterface({ input: server.stdout });
lines.on("line", (line) => {
  console.log(line);
  const match = /Server listening on https?:\/\/\S+:(\d+)/.exec(line);
  if (!match || apiPort) return;

  apiPort = match[1];

  const ui = start("pnpm", ["--filter", "editor_ui_react", "dev"], {
    env: { NOTE_HARBOR_API_PORT: apiPort },
  });
  ui.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[dev] UI exited (${signal ?? code})`);
    shutdown(code ?? 1);
  });
  ui.on("error", (error) => {
    console.error(`[dev] cannot start the UI: ${error.message}`);
    shutdown(1);
  });
});

server.on("exit", (code, signal) => {
  if (shuttingDown) return;
  if (!apiPort) {
    console.error("[dev] the server exited before reporting a port");
  }
  shutdown(code ?? (signal ? 1 : 0));
});

server.on("error", (error) => {
  console.error(`[dev] cannot start cargo: ${error.message}`);
  shutdown(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal === "SIGINT" ? 130 : 143));
}

process.on("exit", () => {
  for (const child of children) killTree(child);
});
