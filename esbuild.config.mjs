import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";
import os from "os";

const prod = (process.argv[2] === "production");
const pluginName = "loom";
const explicitDeployDirs = (process.env.LOOM_PLUGIN_DIRS ?? "")
  .split(path.delimiter)
  .map((value) => value.trim())
  .filter(Boolean);

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "node",
  target: "es2021",
  sourcemap: prod ? false : "inline",
  minify: prod,
  legalComments: "none",
  external: [
    "obsidian",
    "electron",
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/language",
  ],
  logLevel: "info",
});

try {
  const deployDirs = explicitDeployDirs.length ? explicitDeployDirs : discoverVaultPluginDirs(pluginName);

  if (!deployDirs.length) {
    console.warn("No Obsidian vault plugin directories found for deployment.");
  }

  for (const deployDir of deployDirs) {
    fs.mkdirSync(deployDir, { recursive: true });
    fs.copyFileSync("main.js", path.join(deployDir, "main.js"));
    fs.copyFileSync("manifest.json", path.join(deployDir, "manifest.json"));
    if (fs.existsSync("styles.css")) {
      fs.copyFileSync("styles.css", path.join(deployDir, "styles.css"));
    }
    copyDirectoryIfPresent("syntaxes", path.join(deployDir, "syntaxes"));
    console.log(`Deployed build to ${deployDir}`);
  }
} catch (err) {
  console.error("Failed to copy built files to vault plugin directory:", err);
}

function discoverVaultPluginDirs(pluginDirName) {
  const homeDir = os.homedir();
  const candidates = new Set();
  const obsidianDirs = [
    path.join(homeDir, ".obsidian"),
    ...findNestedObsidianDirs(homeDir),
  ];

  for (const obsidianDir of obsidianDirs) {
    candidates.add(path.join(obsidianDir, "plugins", pluginDirName));
  }

  return [...candidates].filter((candidate) => {
    const parent = path.dirname(candidate);
    return fs.existsSync(parent);
  });
}

function findNestedObsidianDirs(homeDir) {
  const results = [];
  for (const entry of fs.readdirSync(homeDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const candidate = path.join(homeDir, entry.name, ".obsidian");
    if (fs.existsSync(candidate)) {
      results.push(candidate);
    }
  }

  return results;
}

function copyDirectoryIfPresent(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  fs.rmSync(destinationDir, { recursive: true, force: true });
  fs.mkdirSync(destinationDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryIfPresent(sourcePath, destinationPath);
      continue;
    }
    fs.copyFileSync(sourcePath, destinationPath);
  }
}
