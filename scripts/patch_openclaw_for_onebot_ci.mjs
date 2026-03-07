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

  if (!pkg.exports["./plugin-sdk/compat"]) {
    pkg.exports["./plugin-sdk/compat"] = {
      types: "./dist/plugin-sdk/compat.d.ts",
      default: "./dist/plugin-sdk/compat.js",
    };
  }

  if (!pkg.exports["./plugin-sdk/core"]) {
    pkg.exports["./plugin-sdk/core"] = {
      types: "./dist/plugin-sdk/core.d.ts",
      default: "./dist/plugin-sdk/core.js",
    };
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

  const newLayoutAnchor = '  "nextcloud-talk",\n';
  if (raw.includes(newLayoutAnchor)) {
    const patched = raw.replace(newLayoutAnchor, `${newLayoutAnchor}  "onebot",\n`);
    writeUtf8(vitestConfigPath, patched);
    return;
  }

  const legacyAliasAnchor = `      {\n        find: "openclaw/plugin-sdk",\n        replacement: path.join(repoRoot, "src", "plugin-sdk", "index.ts"),\n      },\n`;
  if (raw.includes(legacyAliasAnchor)) {
    const insertion = `      {\n        find: "openclaw/plugin-sdk/compat",\n        replacement: path.join(repoRoot, "src", "plugin-sdk", "compat.ts"),\n      },\n      {\n        find: "openclaw/plugin-sdk/core",\n        replacement: path.join(repoRoot, "src", "plugin-sdk", "core.ts"),\n      },\n      {\n        find: "openclaw/plugin-sdk/onebot",\n        replacement: path.join(repoRoot, "src", "plugin-sdk", "onebot.ts"),\n      },\n`;
    const patched = raw.replace(legacyAliasAnchor, `${insertion}${legacyAliasAnchor}`);
    writeUtf8(vitestConfigPath, patched);
    return;
  }

  throw new Error("vitest.config.ts patch anchor not found for onebot plugin-sdk routing");
}

function ensurePluginSdkEntry(upstreamRoot) {
  const pluginSdkDir = path.join(upstreamRoot, "src", "plugin-sdk");
  fs.mkdirSync(pluginSdkDir, { recursive: true });
  const onebotSdkPath = path.join(pluginSdkDir, "onebot.ts");
  const compatSdkPath = path.join(pluginSdkDir, "compat.ts");
  const coreSdkPath = path.join(pluginSdkDir, "core.ts");
  writeUtf8(onebotSdkPath, 'export * from "./index.js";\n');
  if (!fs.existsSync(compatSdkPath)) {
    writeUtf8(compatSdkPath, 'export * from "./index.js";\n');
  }
  if (!fs.existsSync(coreSdkPath)) {
    writeUtf8(coreSdkPath, 'export * from "./index.js";\n');
  }
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
