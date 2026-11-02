const fs = require("fs");
const path = require("path");
const { presetsDir, loadJson, slugify, startupRoot } = require("./lib/preset");

const SLOT_META = {
  curve: { dir: "contracts/modules/curve", template: "templates/curve/Module.sol", kind: "curve" },
  trade: { dir: "contracts/modules/trade", template: "templates/trade/Module.sol", kind: "trade" },
  migrate: { dir: "contracts/modules/migrate", template: "templates/migrate/Module.sol", kind: "migrate" },
  customData: { dir: "contracts/modules/data", template: "templates/data/Module.sol", kind: "customData" },
  data: { dir: "contracts/modules/data", template: "templates/data/Module.sol", kind: "customData" },
  validator: { dir: "contracts/validators", template: "templates/validator/Validator.sol", kind: "validator" },
};

function pascal(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function main() {
  const slot = String(process.env.SLOT || "").trim();
  const meta = SLOT_META[slot];
  if (!meta) {
    throw new Error(`Set SLOT to one of: ${Object.keys(SLOT_META).join(", ")}`);
  }
  const play = slugify(process.env.PRESET && process.env.PRESET !== "fairlaunch" ? process.env.PRESET : (process.env.NAME || "my-play"));
  const tag = String(process.env.TAG || (slot === "validator" ? "" : `module.${meta.kind}.${play.replace(/-/g, "_")}`)).trim();
  const name = pascal(process.env.NAME || (slot === "validator" ? "MyPlayPresetValidator" : `My${pascal(slot)}Module`));
  const dest = path.join(startupRoot(), meta.dir, `${name}.sol`);
  if (fs.existsSync(dest)) throw new Error(`Already exists: ${dest}`);

  const template = fs.readFileSync(path.join(startupRoot(), meta.template), "utf8")
    .replaceAll("{{CONTRACT}}", name)
    .replaceAll("{{TAG}}", tag);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, template);

  const slug = process.env.PRESET && process.env.PRESET !== "fairlaunch" ? slugify(process.env.PRESET) : "";
  let note = "Copy presets/fairlaunch.json to presets/<id>.json and point the slot at this contract.";
  if (slug) {
    const src = path.join(presetsDir(), "fairlaunch.json");
    const destJson = path.join(presetsDir(), `${slug}.json`);
    const preset = fs.existsSync(destJson) ? loadJson(destJson) : loadJson(src);
    preset.id = slug;
    preset.name = preset.name === "FairLaunch" ? pascal(slug) : preset.name;
    if (slot === "validator") {
      preset.validator = { contract: name, args: preset.validator?.args || [] };
    } else {
      preset.modules = preset.modules || {};
      const key = slot === "data" ? "customData" : slot;
      preset.modules[key] = { contract: name, keySource: tag };
    }
    fs.writeFileSync(destJson, `${JSON.stringify(preset, null, 2)}\n`);
    note = `Updated ${destJson}`;
  }

  console.log(JSON.stringify({
    written: dest,
    tag,
    preset: note,
    next: slug
      ? `PRESET=${slug} npx hardhat run scripts/register.js --network bsctestnet`
      : "cp presets/fairlaunch.json presets/my-play.json && edit modules + create",
  }, null, 2));
}

main();
