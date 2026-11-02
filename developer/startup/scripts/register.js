const {
  FEE_ROUTER_ABI,
  connectFork,
  loadJson,
  patchWorkbenchFork,
  registrationPath,
  writeJson,
} = require("./lib/demo");
const {
  KIND,
  REQUIRED_SLOTS,
  isConfiguredSlot,
  isReuse,
  loadPreset,
  lookupModule,
  moduleKeyFromSource,
} = require("./lib/preset");

async function resolveSlot(hre, registry, signer, overrides, config, slot, spec, fork) {
  const kind = KIND[slot];
  const name = spec.contract || spec.keySource || slot;

  if (isReuse(spec)) {
    const found = await lookupModule(registry, spec, slot, fork);
    if (found) {
      return {
        name,
        keySource: found.source,
        moduleKey: found.moduleKey,
        implementation: found.implementation,
        kind,
        reused: true,
      };
    }
    if (!spec.contract) {
      throw new Error(`${slot}: nothing to reuse on this fork for ${spec.keySource || slot}. Add a contract or register the alias first.`);
    }
    console.warn(`${slot}: reuse missed ${spec.keySource || slot}; deploying ${spec.contract}`);
  }

  if (!spec.contract) throw new Error(`modules.${slot} needs contract (or reuse: true / "fork")`);
  if (!spec.keySource) throw new Error(`modules.${slot} needs keySource`);

  const moduleKey = moduleKeyFromSource(spec.keySource);
  const deployed = await hre.ethers.deployContract(spec.contract);
  await deployed.waitForDeployment();
  const implementation = await deployed.getAddress();
  const tx = await registry.upsertModule(
    moduleKey,
    implementation,
    kind,
    {
      moduleId: moduleKey,
      version: config.version || "1.0.0",
      name,
      description: `${config.name} ${name}`,
      author: signer.address,
      feeShareBps: 0,
    },
    true,
    overrides,
  );
  const rec = await tx.wait();
  if (!rec || rec.status !== 1) throw new Error(`upsertModule ${name} failed`);
  return {
    name,
    keySource: spec.keySource,
    moduleKey,
    implementation,
    kind,
    reused: false,
    txHash: rec.hash || tx.hash,
  };
}

async function resolveTokenImpl(hre, registry, signer, overrides, config, fork) {
  const spec = config.tokenImpl || { reuse: "fork" };
  if (isReuse(spec) || !spec.contract) {
    const bondingId = fork.presets?.bondingV1;
    if (!bondingId) throw new Error("fork.json is missing presets.bondingV1; cannot reuse the fork tokenImplId");
    const bonding = await registry.getPreset(bondingId);
    const tokenImplId = bonding.tokenImplId;
    const tokenImpl = await registry.getTokenImpl(tokenImplId);
    if (!tokenImpl.implementation || tokenImpl.implementation === hre.ethers.ZeroAddress) {
      throw new Error(`fork tokenImplId ${tokenImplId} has no implementation`);
    }
    return { tokenImplId, implementation: tokenImpl.implementation, reused: true };
  }

  const tokenImplId = moduleKeyFromSource(spec.keySource || spec.contract);
  const deployed = await hre.ethers.deployContract(spec.contract);
  await deployed.waitForDeployment();
  const implementation = await deployed.getAddress();
  const tx = await registry.upsertTokenImpl(tokenImplId, implementation, config.version || "1.0.0", overrides);
  const rec = await tx.wait();
  if (!rec || rec.status !== 1) throw new Error(`upsertTokenImpl ${spec.contract} failed`);
  return { tokenImplId, implementation, reused: false, txHash: rec.hash || tx.hash };
}

async function main() {
  const hre = require("hardhat");
  const { preset: config, path: presetPath, slug } = loadPreset();
  const ctx = await connectFork(hre);
  const { fork, forkPath, signer, registry, addresses, overrides } = ctx;
  const modules = config.modules || {};

  for (const slot of REQUIRED_SLOTS) {
    if (!isConfiguredSlot(modules[slot])) {
      throw new Error(`modules.${slot} is required in ${presetPath}`);
    }
  }

  const implementations = {};
  const moduleKeys = {};
  const slots = {};
  const developerModules = [];

  for (const slot of [...REQUIRED_SLOTS, "customData"]) {
    const spec = modules[slot];
    if (!isConfiguredSlot(spec)) {
      if (slot === "customData") {
        console.log("customData unused -> bytes32(0)");
        continue;
      }
      throw new Error(`modules.${slot} is required`);
    }
    const resolved = await resolveSlot(hre, registry, signer, overrides, config, slot, spec, fork);
    implementations[resolved.name] = resolved.implementation;
    moduleKeys[resolved.name] = { keySource: resolved.keySource, moduleKey: resolved.moduleKey };
    slots[slot] = resolved;
    if (!resolved.reused) {
      developerModules.push({
        keySource: resolved.keySource,
        moduleKey: resolved.moduleKey,
        implementation: resolved.implementation,
        kind: resolved.kind,
        name: resolved.name,
        txHash: resolved.txHash,
      });
    }
    console.log(`${resolved.reused ? "reused" : "registered"} ${resolved.keySource} -> ${resolved.implementation}`);
  }

  const validatorSpec = typeof config.validator === "string"
    ? { contract: config.validator, args: [] }
    : (config.validator || {});
  if (!validatorSpec.contract) throw new Error("validator.contract is required");
  const validator = await hre.ethers.deployContract(validatorSpec.contract, validatorSpec.args || []);
  await validator.waitForDeployment();
  implementations[validatorSpec.contract] = await validator.getAddress();

  const tokenImpl = await resolveTokenImpl(hre, registry, signer, overrides, config, fork);

  const outFile = registrationPath(slug);
  const existing = require("fs").existsSync(outFile) ? loadJson(outFile) : null;
  const presetId = BigInt(process.env.PRESET_ID || existing?.presetId || Date.now());

  const onChainPreset = {
    id: presetId,
    name: config.name,
    description: config.description || "",
    version: config.version || "1.0.0",
    active: true,
    createEnabled: true,
    validator: implementations[validatorSpec.contract],
    tokenModuleId: slots.token.moduleKey,
    vaultModuleId: slots.vault.moduleKey,
    curveModuleId: slots.curve.moduleKey,
    tradeModuleId: slots.trade.moduleKey,
    migrateModuleId: slots.migrate.moduleKey,
    tokenImplId: tokenImpl.tokenImplId,
    customDataId: slots.customData?.moduleKey || hre.ethers.ZeroHash,
    author: signer.address,
  };

  const presetTx = await registry.upsertPreset(onChainPreset, overrides);
  const presetRec = await presetTx.wait();
  if (!presetRec || presetRec.status !== 1) throw new Error("upsertPreset failed");

  if (addresses.feeRouter && fork.presets?.bondingV1) {
    const feeRouter = await hre.ethers.getContractAt(FEE_ROUTER_ABI, addresses.feeRouter, signer);
    try {
      const cfg = await feeRouter.presetFeeConfig(fork.presets.bondingV1);
      if (cfg.active) {
        const feeTx = await feeRouter.setPresetFeeConfig(presetId, {
          protocolFeeBps: cfg.protocolFeeBps,
          developerFeePoolBps: cfg.developerFeePoolBps,
          maxProtocolDevFeeBps: cfg.maxProtocolDevFeeBps,
          maxTaxBps: cfg.maxTaxBps,
          maxTaxTiers: cfg.maxTaxTiers,
          active: true,
          partnerProtocolShareBps: cfg.partnerProtocolShareBps,
        }, overrides);
        await feeTx.wait();
      }
    } catch (err) {
      console.warn(`preset fee copy skipped: ${err.message || err}`);
    }
  }

  const onChain = await registry.getPreset(presetId);
  if (!onChain.active || !onChain.createEnabled) {
    throw new Error(`${config.name} preset is not active/createEnabled after upsert`);
  }

  const out = {
    slug,
    presetPath,
    network: hre.network.name,
    chainId: ctx.chainId,
    registeredAt: new Date().toISOString(),
    deployer: signer.address,
    forkPath,
    registry: addresses.registry,
    core: addresses.core,
    presetId: presetId.toString(),
    tokenImplId: tokenImpl.tokenImplId,
    tokenImpl: tokenImpl.implementation,
    implementations,
    moduleKeys,
    developerModules,
    presetTx: presetRec.hash || presetTx.hash,
  };
  writeJson(outFile, out);
  patchWorkbenchFork(forkPath, {
    developerModules,
    preset: {
      id: presetId.toString(),
      name: config.name,
      txHash: out.presetTx,
    },
  });

  console.log(JSON.stringify({
    preset: slug,
    presetId: out.presetId,
    registry: out.registry,
    written: outFile,
    next: `PRESET=${slug} npx hardhat run scripts/create-and-trade.js --network ${hre.network.name}`,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
