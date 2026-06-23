import esbuild from "esbuild";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = readArgs(process.argv.slice(2));
const profile = args.profile ?? "full";
const requirePdf = args["require-pdf"] === "true";
const requireAll = args["require-all"] === "true";
const skipBuild = args["skip-build"] === "true";
const fixtureRef = args["fixture-ref"] ?? "vault";
const runtimeVaultDir = path.join(rootDir, ".loom", `smoke-vault-${profile}`);
const artifactDir = path.join(rootDir, ".loom", "artifacts", "smoke", profile);
const pluginDir = path.join(runtimeVaultDir, ".obsidian", "plugins", "loom");
const smokeRunnerOut = path.join(artifactDir, "smoke-runner.mjs");

await rm(runtimeVaultDir, { recursive: true, force: true });
await rm(artifactDir, { recursive: true, force: true });
await mkdir(artifactDir, { recursive: true });
await mkdir(runtimeVaultDir, { recursive: true });
await materializeVaultFixture(fixtureRef, runtimeVaultDir);
await mkdir(pluginDir, { recursive: true });

if (!skipBuild) {
  await run("npm", ["run", "build"], {
    cwd: rootDir,
    env: {
      ...process.env,
      LOOM_PLUGIN_DIRS: pluginDir,
    },
  });
}

const artifactManifest = await assertCompiledPluginInstall(pluginDir);
await writeFile(path.join(artifactDir, "compiled-plugin.json"), JSON.stringify(artifactManifest, null, 2), "utf8");
await run(process.execPath, [
  path.join(rootDir, "scripts", "compiled-plugin-smoke.cjs"),
  pluginDir,
  path.join(artifactDir, "compiled-plugin-load.json"),
], { cwd: rootDir });

await esbuild.build({
  entryPoints: [path.join(rootDir, "scripts", "smoke-runner.ts")],
  bundle: true,
  outfile: smokeRunnerOut,
  format: "esm",
  platform: "node",
  target: "es2022",
  sourcemap: false,
  legalComments: "none",
  logLevel: "silent",
});

await run(process.execPath, [
  smokeRunnerOut,
  "--vault",
  runtimeVaultDir,
  "--artifacts",
  artifactDir,
  "--profile",
  profile,
  ...(requirePdf ? ["--require-pdf"] : []),
  ...(requireAll ? ["--require-all"] : []),
], { cwd: rootDir });

console.log(`Smoke artifacts written to ${path.relative(rootDir, artifactDir)}`);

async function run(command, commandArgs, options) {
  const child = spawn(command, commandArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit ${exitCode}`);
  }
}

async function runPiped(leftCommand, leftArgs, rightCommand, rightArgs, options) {
  const left = spawn(leftCommand, leftArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "inherit"],
    shell: false,
  });
  const right = spawn(rightCommand, rightArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["pipe", "inherit", "inherit"],
    shell: false,
  });

  left.stdout.pipe(right.stdin);

  const [leftExit, rightExit] = await Promise.all([
    waitForProcess(left),
    waitForProcess(right),
  ]);

  if (leftExit !== 0 || rightExit !== 0) {
    throw new Error(`${leftCommand} ${leftArgs.join(" ")} | ${rightCommand} ${rightArgs.join(" ")} failed with exits ${leftExit}/${rightExit}`);
  }
}

async function waitForProcess(child) {
  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
}

async function materializeVaultFixture(ref, destinationDir) {
  await runPiped("git", ["archive", "--format=tar", ref], "tar", ["-x", "-C", destinationDir], { cwd: rootDir });
}

async function runCapture(command, commandArgs, options) {
  let stdout = "";
  let stderr = "";
  const child = spawn(command, commandArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: false,
  });
  child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit ${exitCode}\n${stderr}`);
  }
  return { stdout, stderr };
}

async function assertCompiledPluginInstall(dir) {
  const files = await listFiles(dir);
  const relativeFiles = files.map((file) => path.relative(dir, file).split(path.sep).join("/")).sort();
  const forbidden = relativeFiles.filter((file) =>
    file.endsWith(".ts") ||
    file.startsWith("src/") ||
    file.startsWith("scripts/") ||
    file.startsWith("test-vault/") ||
    file === "package.json" ||
    file === "tsconfig.json"
  );
  if (forbidden.length) {
    throw new Error(`Compiled plugin install contains source files: ${forbidden.join(", ")}`);
  }
  for (const required of ["main.js", "manifest.json"]) {
    if (!relativeFiles.includes(required)) {
      throw new Error(`Compiled plugin install is missing ${required}`);
    }
  }

  const entries = [];
  for (const file of files) {
    const content = await readFile(file);
    entries.push({
      path: path.relative(dir, file).split(path.sep).join("/"),
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    pluginDir: path.relative(rootDir, dir),
    files: entries.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function readArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      continue;
    }
    const [key, inlineValue] = value.slice(2).split("=", 2);
    parsed[key] = inlineValue ?? (values[index + 1]?.startsWith("--") ? "true" : values[++index] ?? "true");
  }
  return parsed;
}
