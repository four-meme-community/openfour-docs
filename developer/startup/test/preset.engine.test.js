const { expect } = require("chai");
const { ethers } = require("hardhat");
const { encodeFairLaunchParams, MAX_SUPPLY, RAISE_AMOUNT, SALE_AMOUNT } = require("../scripts/lib/demo");
const { encodeCreateParams, FAIRLAUNCH_OFFLINE_SCHEMAS, flattenCreateForm } = require("../scripts/lib/schema");
const { FORK_ALIASES, candidateKeys, presetSlug, loadPreset, slugify } = require("../scripts/lib/preset");

describe("preset engine", function () {
  it("loads fairlaunch.json and slugs the id", function () {
    const { preset, slug } = loadPreset("fairlaunch");
    expect(preset.name).to.equal("FairLaunch");
    expect(slug).to.equal("fairlaunch");
    expect(slugify("My Play")).to.equal("my-play");
    expect(presetSlug("/tmp/my-play.json", "my-play")).to.equal("my-play");
    expect(presetSlug("/tmp/my-play.json", "fairlaunch")).to.equal("fairlaunch");
    expect(presetSlug("/tmp/my-play.json", "./presets/my-play.json")).to.equal("my-play");
  });

  it("maps official fork aliases to TOKEN_STANDARD / VAULT_BASIC", function () {
    expect(FORK_ALIASES["module.token.standard"]).to.equal("TOKEN_STANDARD");
    expect(FORK_ALIASES["module.vault.standard"]).to.equal("VAULT_BASIC");
    const keys = candidateKeys({ keySource: "module.token.standard", reuse: true }, "token", {
      moduleIds: { TOKEN_STANDARD: ethers.ZeroHash },
    });
    expect(keys.map((row) => row.source)).to.include("module.token.standard");
    expect(keys.map((row) => row.source)).to.include("TOKEN_STANDARD");
  });

  it("does not fall back to a bonding slot for an unknown reuse key", function () {
    const keys = candidateKeys({ keySource: "module.curve.my_play", reuse: true }, "curve", {});
    expect(keys.map((row) => row.source)).to.deep.equal(["module.curve.my_play"]);
  });

  it("reuse:fork uses the official slot key", function () {
    const keys = candidateKeys({ reuse: "fork" }, "token", {});
    expect(keys.map((row) => row.source)).to.include("TOKEN_STANDARD");
  });

  it("fills schema defaultValue when a field is omitted", function () {
    const encoded = require("../scripts/lib/schema").encodeModuleParams(
      { params: [{ name: "fixedPrice", abiType: "uint256", decimals: 18, optional: false, defaultValue: "0.0001" }] },
      {},
    );
    const expected = require("../scripts/lib/schema").encodeModuleParams(
      { params: [{ name: "fixedPrice", abiType: "uint256", decimals: 18, optional: false }] },
      { fixedPrice: "0.0001" },
    );
    expect(encoded).to.equal(expected);
  });

  it("encodes fairlaunch.json the same way as the offline FairLaunch schema", function () {
    const { preset } = loadPreset("fairlaunch");
    const fromFile = encodeCreateParams(flattenCreateForm(preset.create), FAIRLAUNCH_OFFLINE_SCHEMAS);
    const fromHelper = encodeFairLaunchParams();
    expect(fromFile.curveParams).to.equal(fromHelper.curveParams);
    expect(fromFile.tradeParams).to.equal(fromHelper.tradeParams);
    expect(fromFile.migrateParams).to.equal(fromHelper.migrateParams);
    expect(MAX_SUPPLY).to.equal(ethers.parseUnits("1000000", 18));
    expect(SALE_AMOUNT).to.equal(ethers.parseUnits("800000", 18));
    expect(RAISE_AMOUNT).to.equal(ethers.parseUnits("80", 18));
  });
});
