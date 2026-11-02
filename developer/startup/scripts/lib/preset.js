const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const KIND = { token: 0, vault: 1, curve: 2, trade: 3, migrate: 4, customData: 5 };
const REQUIRED_SLOTS = ["token", "vault", "curve", "trade", "migrate"];

const FORK_ALIASES = {
  "module.token.standard": "TOKEN_STANDARD",
  "module.vault.standard": "VAULT_BASIC",
  "module.vault.basic": "VAULT_BASIC",
  "module.curve.bonding": "CURVE_BONDING",
  "module.trade.simple": "TRADE_SIMPLE",
  "module.migrate.bonding": "MIGRATE_BONDING",
  TOKEN_STANDARD: "TOKEN_STANDARD",
  VAULT_BASIC: "VAULT_BASIC",
  CURVE_BONDING: "CURVE_BONDING",
  TRADE_SIMPLE: "TRADE_SIMPLE",
  MIGRATE_BONDING: "MIGRATE_BONDING",
};

const FORK_SLOT_KEYS = {
  token: "TOKEN_STANDARD",
  vault: "VAULT_BASIC",
  curve: "CURVE_BONDING",
  trade: "TRADE_SIMPLE",
  migrate: "MIGRATE_BONDING",
};

function startupRoot() {
  return path.resolve(__dirname, "../..");
}

function presetsDir() {
  return path.join(startupRoot(), "presets");
}

function slugify(value) {
  return String(value || "preset")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "preset";
}

function presetIdFromEnv() {
  return (process.env.PRESET || "fairlaunch").trim();
}

function resolvePresetPath(id = presetIdFromEnv()) {
  if (!id) return path.join(presetsDir(), "fairlaunch.json");
  if (id.endsWith(".json") || id.includes("/") || id.includes("\\")) {
    return path.resolve(process.cwd(), id);
  }
  return path.join(presetsDir(), `${slugify(id)}.json`);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function presetSlug(filePath, requested = presetIdFromEnv()) {
  const fileSlug = slugify(path.basename(filePath, ".json"));
  const raw = String(requested || "").trim();
  if (raw && !raw.includes("/") && !raw.includes("\\") && !raw.endsWith(".json")) {
    return slugify(raw);
  }
  return fileSlug;
}

function loadPreset(id = presetIdFromEnv()) {
  const filePath = resolvePresetPath(id);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Preset file not found: ${filePath}. Copy presets/fairlaunch.json and set PRESET.`);
  }
  const preset = loadJson(filePath);
  const slug = presetSlug(filePath, id);
  return { preset: { ...preset, id: preset.id || slug }, path: filePath, slug };
}

function isReuse(spec) {
  return spec === true || spec === "fork" || spec === "true" || spec?.reuse === true || spec?.reuse === "fork" || spec?.reuse === "true";
}

function isConfiguredSlot(spec) {
  if (spec == null || spec === false || spec === "") return false;
  if (typeof spec !== "object") return false;
  if (isReuse(spec)) return true;
  return Boolean(String(spec.contract || "").trim() || String(spec.keySource || "").trim());
}

function moduleKeyFromSource(source) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(source || "").trim()));
}

function candidateKeys(spec, slot, fork) {
  const keys = [];
  const seen = new Set();
  const push = (source) => {
    if (!source) return;
    const label = String(source).trim();
    if (!label || seen.has(label)) return;
    seen.add(label);
    keys.push({ source: label, moduleKey: moduleKeyFromSource(label) });
  };

  push(spec?.keySource);
  if (spec?.keySource && FORK_ALIASES[spec.keySource]) push(FORK_ALIASES[spec.keySource]);
  if (spec === "fork" || spec?.reuse === "fork") push(FORK_SLOT_KEYS[slot]);

  const forkIds = fork?.moduleIds || {};
  for (const row of [...keys]) {
    const id = forkIds[row.source];
    if (id && id !== ethers.ZeroHash && String(id).toLowerCase() !== String(row.moduleKey).toLowerCase()) {
      keys.push({ source: row.source, moduleKey: id });
    }
  }
  return keys;
}

async function lookupModule(registry, spec, slot, fork) {
  for (const row of candidateKeys(spec, slot, fork)) {
    const implementation = await registry.getModuleImplementation(row.moduleKey);
    if (implementation && implementation !== ethers.ZeroAddress) {
      return { ...row, implementation };
    }
  }
  return null;
}

function presetAmounts(preset) {
  const create = preset.create || {};
  const loop = preset.loop || {};
  return {
    maxSupply: ethers.parseUnits(String(create.maxSupply ?? "0"), 18),
    saleAmount: ethers.parseUnits(String(create.saleAmount ?? "0"), 18),
    raiseAmount: ethers.parseUnits(String(create.raiseAmount ?? "0"), 18),
    buyAmount: ethers.parseUnits(String(loop.buyAmount ?? "1"), 18),
    sellAmount: ethers.parseUnits(String(loop.sellAmount ?? "0.5"), 18),
  };
}

module.exports = {
  FORK_ALIASES,
  FORK_SLOT_KEYS,
  KIND,
  REQUIRED_SLOTS,
  candidateKeys,
  isConfiguredSlot,
  isReuse,
  loadJson,
  loadPreset,
  lookupModule,
  moduleKeyFromSource,
  presetAmounts,
  presetIdFromEnv,
  presetSlug,
  presetsDir,
  resolvePresetPath,
  slugify,
  startupRoot,
};
