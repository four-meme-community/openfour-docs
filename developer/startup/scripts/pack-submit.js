const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { loadRegistration, outDir, writeJson } = require("./lib/demo");
const { loadPreset, startupRoot } = require("./lib/preset");

function gitRev() {
  try {
    return execSync("git rev-parse HEAD", { cwd: path.resolve(startupRoot(), "../.."), encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function tokenRecords(presetId) {
  const filePath = path.resolve(startupRoot(), "../workbench/data/tokens.json");
  if (!fs.existsSync(filePath)) return [];
  const current = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const tokens = Array.isArray(current.tokens) ? current.tokens : [];
  return tokens.filter((row) => String(row.presetId) === String(presetId)).slice(0, 20);
}

function findContractFile(name) {
  const root = path.join(startupRoot(), "contracts");
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(next);
      else if (ent.name === `${name}.sol`) return path.relative(startupRoot(), next);
    }
  }
  return name;
}

function sourceFiles(preset) {
  const names = [];
  for (const spec of Object.values(preset.modules || {})) {
    if (spec?.contract) names.push(spec.contract);
  }
  const validator = typeof preset.validator === "string" ? preset.validator : preset.validator?.contract;
  if (validator) names.push(validator);
  if (preset.tokenImpl?.contract) names.push(preset.tokenImpl.contract);
  return [...new Set(names.map(findContractFile))];
}

function main() {
  const { preset, path: presetPath, slug } = loadPreset();
  const { registration, path: registrationFile } = loadRegistration(slug);
  const pack = {
    kind: "openfour-submit-pack",
    version: "1",
    createdAt: new Date().toISOString(),
    gitRev: gitRev(),
    preset: {
      id: slug,
      name: preset.name,
      description: preset.description,
      path: presetPath,
      modules: preset.modules,
      validator: preset.validator,
      tokenImpl: preset.tokenImpl || { reuse: "fork" },
    },
    sources: sourceFiles(preset),
    registration: {
      path: registrationFile,
      registry: registration.registry,
      core: registration.core,
      presetId: registration.presetId,
      tokenImplId: registration.tokenImplId,
      moduleKeys: registration.moduleKeys,
    },
    forkRegistry: registration.registry,
    tokens: tokenRecords(registration.presetId),
    notes: [
      "Do not upsert production Registries yourself.",
      "Include this file, module source, tests, and the fork Registry address on four.meme.",
      "If this Preset needs extra frontend pages, build a temporary UI with developer/frontend-style/ (official website look) and submit it with the audit pack. OpenFour ports approved flows into the official site; the temporary page is reference only.",
    ],
    frontendStyle: "developer/frontend-style/",
  };
  const outFile = path.join(outDir(), `${slug}-submit-pack.json`);
  writeJson(outFile, pack);
  console.log(JSON.stringify({ written: outFile, forkRegistry: pack.forkRegistry, presetId: pack.registration.presetId }, null, 2));
}

main();
