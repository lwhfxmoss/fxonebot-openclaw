#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeUtf8(filePath, content) {
  fs.writeFileSync(filePath, content, "utf8");
}

function patchPackageJson(upstreamRoot) {
  const packageJsonPath = path.join(upstreamRoot, "package.json");
  const raw = readUtf8(packageJsonPath);
  const pkg = JSON.parse(raw);

  if (!pkg.exports || typeof pkg.exports !== "object") {
    throw new Error("package.json missing exports object");
  }

  pkg.exports["./plugin-sdk/onebot"] = {
    types: "./dist/plugin-sdk/onebot.d.ts",
    default: "./dist/plugin-sdk/onebot.js",
  };

  writeUtf8(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function patchVitestConfig(upstreamRoot) {
  const vitestConfigPath = path.join(upstreamRoot, "vitest.config.ts");
  const raw = readUtf8(vitestConfigPath);

  if (raw.includes('"onebot"')) {
    return;
  }

  const anchor = '  "nextcloud-talk",\n';
  if (!raw.includes(anchor)) {
    throw new Error("vitest.config.ts anchor not found for pluginSdkSubpaths");
  }

  const patched = raw.replace(anchor, `${anchor}  "onebot",\n`);
  writeUtf8(vitestConfigPath, patched);
}

function ensurePluginSdkEntry(upstreamRoot) {
  const pluginSdkDir = path.join(upstreamRoot, "src", "plugin-sdk");
  fs.mkdirSync(pluginSdkDir, { recursive: true });
  const onebotSdkPath = path.join(pluginSdkDir, "onebot.ts");
  writeUtf8(onebotSdkPath, 'export * from "./index.js";\n');
}

function main() {
  const upstreamRoot = process.argv[2];
  if (!upstreamRoot) {
    throw new Error("Usage: patch_openclaw_for_onebot_ci.mjs <upstreamRoot>");
  }

  patchPackageJson(upstreamRoot);
  patchVitestConfig(upstreamRoot);
  ensurePluginSdkEntry(upstreamRoot);
}

main();
