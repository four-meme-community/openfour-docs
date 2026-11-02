/**
 * Fork a new proxy set from the shared developer hub (source/bsctestnet.json).
 *
 * Does not compile or deploy OpenFour implementations. New proxies point at
 * existing hub implementations, and the five standard modules register those
 * same implementations. The hub proxies themselves are never written.
 *
 *   cd developer/fork-deploy && npm install
 *   cp .env.example .env    # fill DEPLOYER_PRIVATE_KEY (RPC defaults to publicnode)
 *   npm run fork:dry
 *   npm run fork
 *
 * RPC defaults to https://bsc-testnet.publicnode.com. Do not use private RPC
 * keys. Must be that testnet itself, or an anvil/hardhat fork of it.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");

dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, ".env") });

const ERC1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// deployments/bsctestnet.log: the current Registry proxy's direct CREATE tx.
const DEFAULT_PROXY_DEPLOY_TX =
  "0xc5e66936272ac4779c5c8388becbd86b0569a42b9ace144b174d0a5428b4620e";

const MODULES = [
  ["TOKEN_STANDARD", 0],
  ["VAULT_BASIC", 1],
  ["CURVE_BONDING", 2],
  ["TRADE_SIMPLE", 3],
  ["MIGRATE_BONDING", 4],
];

const registryAbi = [
  "function initialize()",
  "function owner() view returns (address)",
  "function getModule(bytes32 moduleKey) view returns (tuple(address beacon, uint8 kind, tuple(bytes32 moduleId, string version, string name, string description, address author, uint16 feeShareBps) metadata, bool active))",
  "function getModuleImplementation(bytes32 moduleKey) view returns (address)",
  "function getPreset(uint256 presetId) view returns (tuple(uint256 id, string name, string description, string version, bool active, bool createEnabled, address validator, bytes32 tokenModuleId, bytes32 vaultModuleId, bytes32 curveModuleId, bytes32 tradeModuleId, bytes32 migrateModuleId, bytes32 tokenImplId, bytes32 customDataId, address author))",
  "function getTokenImpl(bytes32 tokenImplId) view returns (tuple(address implementation, string version))",
  "function setOpenFourCore(address core)",
  "function setOpenFourTool(address tool)",
  "function setCreateDeployer(address deployer)",
  "function upsertModule(bytes32 moduleKey, address implementation, uint8 kind, tuple(bytes32 moduleId, string version, string name, string description, address author, uint16 feeShareBps) metadata, bool active)",
  "function upsertTokenImpl(bytes32 tokenImplId, address implementation, string version)",
  "function upsertPreset(tuple(uint256 id, string name, string description, string version, bool active, bool createEnabled, address validator, bytes32 tokenModuleId, bytes32 vaultModuleId, bytes32 curveModuleId, bytes32 tradeModuleId, bytes32 migrateModuleId, bytes32 tokenImplId, bytes32 customDataId, address author) preset)",
  "function getModuleBeacon(bytes32 moduleKey) view returns (address)",
];

const feeRouterAbi = [
  "function initialize(address registry_, address treasury_)",
  "function setCore(address newCore)",
  "function setRebate(address newRebate)",
  "function feeConfig() view returns (uint16 protocolFeeBps, uint16 developerFeePoolBps, uint16 maxProtocolDevFeeBps, uint16 maxTaxBps, uint8 maxTaxTiers, uint256 partnerProtocolShareBps, uint256 placeholder2, uint256 placeholder3, uint256 placeholder4, uint256 placeholder5, uint256 placeholder6)",
  "function setFeeConfig(tuple(uint16 protocolFeeBps, uint16 developerFeePoolBps, uint16 maxProtocolDevFeeBps, uint16 maxTaxBps, uint8 maxTaxTiers, uint256 partnerProtocolShareBps, uint256 placeholder2, uint256 placeholder3, uint256 placeholder4, uint256 placeholder5, uint256 placeholder6) cfg)",
  "function presetFeeConfig(uint256 presetId) view returns (uint16 protocolFeeBps, uint16 developerFeePoolBps, uint16 maxProtocolDevFeeBps, uint16 maxTaxBps, uint8 maxTaxTiers, bool active, uint256 partnerProtocolShareBps)",
  "function setPresetFeeConfig(uint256 presetId, tuple(uint16 protocolFeeBps, uint16 developerFeePoolBps, uint16 maxProtocolDevFeeBps, uint16 maxTaxBps, uint8 maxTaxTiers, bool active, uint256 partnerProtocolShareBps) cfg)",
  "function rebate() view returns (address)",
  "function owner() view returns (address)",
];

const coreAbi = [
  "function initialize(address registry_, address feeRouter_, address wrappedNative_, address signer_)",
  "function wrappedNative() view returns (address)",
  "function signer() view returns (address)",
  "function registry() view returns (address)",
  "function owner() view returns (address)",
];

const deployerAbi = [
  "function initialize(address registry_)",
  "function setCore(address newCore)",
  "function owner() view returns (address)",
];

const toolsAbi = [
  "function initialize(address core_)",
  "function owner() view returns (address)",
];

function splitErc1967DeployInput(input) {
  const hex = input.startsWith("0x") ? input.slice(2) : input;
  if (hex.length % 2 !== 0) throw new Error("proxy deploy tx input is not valid hex");
  const buf = Buffer.from(hex, "hex");
  // constructor(address, bytes) ABI suffix is at least 4 words (4-byte initialize pads to 32 bytes).
  for (let argLen = 128; argLen <= buf.length - 32; argLen += 32) {
    const start = buf.length - argLen;
    const offset = BigInt("0x" + buf.subarray(start + 32, start + 64).toString("hex"));
    if (offset !== 0x40n) continue;
    const dataLen = Number(BigInt("0x" + buf.subarray(start + 64, start + 96).toString("hex")));
    if (!Number.isSafeInteger(dataLen) || dataLen < 0 || dataLen > 100_000) continue;
    const padded = Math.ceil(dataLen / 32) * 32;
    if (96 + padded !== argLen) continue;
    if (!buf.subarray(start, start + 12).equals(Buffer.alloc(12))) continue;
    const creationCode = "0x" + buf.subarray(0, start).toString("hex");
    if (!creationCode.startsWith("0x60806040") && !creationCode.startsWith("0x60")) {
      continue;
    }
    return { creationCode, argLen };
  }
  throw new Error(
    "Could not split ERC1967Proxy creation bytecode from the deploy tx. Confirm PROXY_DEPLOY_TX is the proxy's direct CREATE, not a factory call."
  );
}

function sourceDeploymentPath() {
  if (process.env.SOURCE_DEPLOYMENT && process.env.SOURCE_DEPLOYMENT.trim() !== "") {
    return path.resolve(process.env.SOURCE_DEPLOYMENT.trim());
  }
  return path.resolve(__dirname, "source/bsctestnet.json");
}

function txOverrides(chainId) {
  // BSC Testnet: 0.05 gwei. Do not raise this.
  if (chainId === 97n) return { gasPrice: 50_000_000n };
  if (chainId === 56n) return { gasPrice: 50_000_000n };
  return {};
}

function addrOr(envName, fallback) {
  const raw = process.env[envName];
  if (raw && raw.trim() !== "") return ethers.getAddress(raw.trim());
  return fallback;
}

async function requireCode(provider, label, address) {
  const code = await provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(
      `${label} ${address} has no bytecode on this RPC. Point RPC_URL at a deployed testnet or a fork of that testnet.`
    );
  }
  return code;
}

async function readImpl(provider, proxy) {
  const raw = await provider.getStorage(proxy, ERC1967_IMPL_SLOT);
  if (!raw || raw === "0x" + "0".repeat(64)) {
    throw new Error(`${proxy} has no ERC-1967 implementation slot; not the expected UUPS proxy`);
  }
  const impl = ethers.getAddress("0x" + raw.slice(-40));
  await requireCode(provider, `implementation ${proxy} ->`, impl);
  return impl;
}

async function getDeployInput(provider, hash) {
  const tx = await provider.send("eth_getTransactionByHash", [hash]);
  if (!tx) throw new Error(`proxy deploy tx not found: ${hash}`);
  const input = tx.input || tx.data;
  if (!input || input === "0x") throw new Error(`deploy tx ${hash} has no input`);
  return input;
}

function loadPlanNumbers(presetIdRaw) {
  if (presetIdRaw === undefined || presetIdRaw === null || presetIdRaw === "") {
    throw new Error("deployment JSON has no presets.bondingV1; set PRESET_ID to override");
  }
  return BigInt(presetIdRaw);
}

async function readSource(provider, deployment) {
  const A = deployment.addresses;
  for (const key of ["registry", "feeRouter", "core", "createDeployer", "tools"]) {
    if (!A[key]) throw new Error(`deployment JSON missing addresses.${key}`);
    A[key] = ethers.getAddress(A[key]);
  }

  const presetId = loadPlanNumbers(process.env.PRESET_ID || deployment.presets?.bondingV1);
  const registry = new ethers.Contract(A.registry, registryAbi, provider);
  const feeRouter = new ethers.Contract(A.feeRouter, feeRouterAbi, provider);
  const core = new ethers.Contract(A.core, coreAbi, provider);

  const impls = {
    registry: await readImpl(provider, A.registry),
    feeRouter: await readImpl(provider, A.feeRouter),
    core: await readImpl(provider, A.core),
    createDeployer: await readImpl(provider, A.createDeployer),
    tools: await readImpl(provider, A.tools),
  };

  const modules = [];
  for (const [name, expectedKind] of MODULES) {
    const moduleId = ethers.keccak256(ethers.toUtf8Bytes(name));
    const listed = deployment.moduleIds?.[name];
    if (listed && listed.toLowerCase() !== moduleId.toLowerCase()) {
      throw new Error(`${name} moduleId does not match deployment JSON`);
    }
    const rec = await registry.getModule(moduleId);
    if (rec.beacon === ethers.ZeroAddress) {
      throw new Error(`source Registry has not registered ${name}`);
    }
    if (BigInt(rec.kind) !== BigInt(expectedKind)) {
      throw new Error(`${name} kind is ${rec.kind}, expected ${expectedKind}`);
    }
    const implementation = ethers.getAddress(await registry.getModuleImplementation(moduleId));
    await requireCode(provider, name, implementation);
    modules.push({
      name,
      moduleId,
      kind: Number(expectedKind),
      implementation,
      sourceBeacon: ethers.getAddress(rec.beacon),
      version: rec.metadata.version,
      description: rec.metadata.description,
      feeShareBps: Number(rec.metadata.feeShareBps),
      active: Boolean(rec.active),
    });
  }

  const preset = await registry.getPreset(presetId);
  if (preset.id === 0n) throw new Error(`source Registry has no preset ${presetId}`);
  // The live bonding preset may already point at a newer migrate. The fork pins these five standard modules.
  const pinned = {
    tokenModuleId: modules[0].moduleId,
    vaultModuleId: modules[1].moduleId,
    curveModuleId: modules[2].moduleId,
    tradeModuleId: modules[3].moduleId,
    migrateModuleId: modules[4].moduleId,
  };
  for (const [field, id] of Object.entries(pinned)) {
    if (preset[field].toLowerCase() !== id.toLowerCase()) {
      console.log(`preset ${presetId} ${field} differs from the ${field.replace("ModuleId", "")} standard module; fork uses the standard module`);
    }
  }
  if (preset.customDataId !== ethers.ZeroHash) {
    console.log(`preset ${presetId} has customData; fork does not copy it`);
  }

  const tokenImpl = await registry.getTokenImpl(preset.tokenImplId);
  const tokenImplAddress = ethers.getAddress(tokenImpl.implementation);
  if (tokenImplAddress === ethers.ZeroAddress) {
    throw new Error(`preset tokenImplId ${preset.tokenImplId} has no implementation`);
  }
  await requireCode(provider, "OpenFourToken implementation", tokenImplAddress);

  let validator = ethers.getAddress(preset.validator);
  if (validator !== ethers.ZeroAddress) {
    const validatorCode = await provider.getCode(validator);
    if (!validatorCode || validatorCode === "0x") validator = ethers.ZeroAddress;
  }

  const feeConfig = await feeRouter.feeConfig();
  const presetFee = await feeRouter.presetFeeConfig(presetId);
  const wrappedNative = ethers.getAddress(await core.wrappedNative());
  await requireCode(provider, "wrapped native", wrappedNative);

  return {
    source: A,
    presetId,
    impls,
    modules,
    preset: {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      version: preset.version,
      active: preset.active,
      createEnabled: preset.createEnabled,
      validator,
      ...pinned,
      tokenImplId: preset.tokenImplId,
      customDataId: ethers.ZeroHash,
    },
    tokenImpl: { address: tokenImplAddress, version: tokenImpl.version },
    feeConfig: {
      protocolFeeBps: Number(feeConfig.protocolFeeBps),
      developerFeePoolBps: Number(feeConfig.developerFeePoolBps),
      maxProtocolDevFeeBps: Number(feeConfig.maxProtocolDevFeeBps),
      maxTaxBps: Number(feeConfig.maxTaxBps),
      maxTaxTiers: Number(feeConfig.maxTaxTiers),
      partnerProtocolShareBps: feeConfig.partnerProtocolShareBps,
      placeholder2: feeConfig.placeholder2,
      placeholder3: feeConfig.placeholder3,
      placeholder4: feeConfig.placeholder4,
      placeholder5: feeConfig.placeholder5,
      placeholder6: feeConfig.placeholder6,
    },
    presetFee: presetFee.active
      ? {
          protocolFeeBps: Number(presetFee.protocolFeeBps),
          developerFeePoolBps: Number(presetFee.developerFeePoolBps),
          maxProtocolDevFeeBps: Number(presetFee.maxProtocolDevFeeBps),
          maxTaxBps: Number(presetFee.maxTaxBps),
          maxTaxTiers: Number(presetFee.maxTaxTiers),
          active: true,
          partnerProtocolShareBps: presetFee.partnerProtocolShareBps,
        }
      : null,
    wrappedNative,
  };
}

async function deployProxy(creationCode, impl, initData, wallet, overrides) {
  const factory = new ethers.ContractFactory(
    ["constructor(address implementation, bytes _data)"],
    creationCode,
    wallet
  );
  const contract = await factory.deploy(impl, initData, overrides);
  const tx = contract.deploymentTransaction();
  console.log(`  deploy proxy impl=${impl} tx=${tx.hash}`);
  await contract.waitForDeployment();
  return ethers.getAddress(await contract.getAddress());
}

async function send(label, contract, fn, args, protectedSet, overrides) {
  const to = await contract.getAddress();
  if (protectedSet.has(to.toLowerCase())) {
    throw new Error(`refusing to send a tx to a source contract: ${label} -> ${to}`);
  }
  const tx = await contract.getFunction(fn)(...args, overrides);
  console.log(`  ${label} tx=${tx.hash}`);
  const rc = await tx.wait();
  if (rc.status !== 1) throw new Error(`${label} failed`);
}

function selfTest() {
  const creationCode = "0x60806040" + "11".repeat(80);
  const impl = "0x902905C4Ce20E8d7C0d2c3921b688B4342086441";
  const initData = "0x8129fc1c";
  const args = ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [impl, initData]);
  const split = splitErc1967DeployInput(creationCode + args.slice(2));
  if (split.creationCode !== creationCode) {
    throw new Error("creation bytecode split is incorrect");
  }
  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
    ["address", "bytes"],
    "0x" + (creationCode + args.slice(2)).slice(split.creationCode.length)
  );
  if (ethers.getAddress(decoded[0]) !== impl || decoded[1] !== initData) {
    throw new Error("constructor args did not decode correctly");
  }
  console.log("self-test ok");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const rpc = process.env.RPC_URL || process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet.publicnode.com";
  if (/nodereal\.io/i.test(rpc)) {
    throw new Error("Do not use a private NodeReal URL in this toolkit. Use https://bsc-testnet.publicnode.com (or another public RPC).");
  }
  const dryRun = process.env.DRY_RUN === "1";
  const provider = new ethers.JsonRpcProvider(rpc);
  const network = await provider.getNetwork();
  const deploymentPath = sourceDeploymentPath();
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`source address list not found: ${deploymentPath}. Restore source/bsctestnet.json or set SOURCE_DEPLOYMENT.`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const proxyTx = (process.env.PROXY_DEPLOY_TX || DEFAULT_PROXY_DEPLOY_TX).trim();
  console.log(`reading proxy creation bytecode: ${proxyTx}`);
  const deployInput = await getDeployInput(provider, proxyTx);
  const { creationCode } = splitErc1967DeployInput(deployInput);
  console.log(`creation bytecode ${(creationCode.length - 2) / 2} bytes, chainId=${network.chainId}`);

  const source = await readSource(provider, deployment);
  console.log("source proxies", source.source.registry);
  console.log("reused implementations", source.impls);
  for (const mod of source.modules) {
    console.log(`module ${mod.name} impl=${mod.implementation} beacon=${mod.sourceBeacon} active=${mod.active}`);
  }
  console.log(
    `preset ${source.presetId} ${source.preset.name} tokenImpl=${source.tokenImpl.address} validator=${source.preset.validator}`
  );

  if (dryRun) {
    console.log("DRY_RUN=1, no transactions sent.");
    return;
  }

  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("missing DEPLOYER_PRIVATE_KEY");
  const wallet = new ethers.Wallet(pk, provider);
  const overrides = txOverrides(network.chainId);
  const treasury = addrOr("TREASURY_ADDRESS", wallet.address);
  const signer = addrOr("SIGNER_ADDRESS", wallet.address);
  const presetAuthor = addrOr("PRESET_AUTHOR", wallet.address);
  const protectedSet = new Set(Object.values(source.source).map((a) => a.toLowerCase()));

  console.log(`deployer ${wallet.address} treasury=${treasury} signer=${signer}`);

  const registryInit = new ethers.Interface(registryAbi).encodeFunctionData("initialize", []);
  const registryAddr = await deployProxy(creationCode, source.impls.registry, registryInit, wallet, overrides);

  const feeRouterInit = new ethers.Interface(feeRouterAbi).encodeFunctionData("initialize", [
    registryAddr,
    treasury,
  ]);
  const feeRouterAddr = await deployProxy(
    creationCode,
    source.impls.feeRouter,
    feeRouterInit,
    wallet,
    overrides
  );

  const deployerInit = new ethers.Interface(deployerAbi).encodeFunctionData("initialize", [registryAddr]);
  const deployerAddr = await deployProxy(
    creationCode,
    source.impls.createDeployer,
    deployerInit,
    wallet,
    overrides
  );

  const coreInit = new ethers.Interface(coreAbi).encodeFunctionData("initialize", [
    registryAddr,
    feeRouterAddr,
    source.wrappedNative,
    signer,
  ]);
  const coreAddr = await deployProxy(creationCode, source.impls.core, coreInit, wallet, overrides);

  const toolsInit = new ethers.Interface(toolsAbi).encodeFunctionData("initialize", [coreAddr]);
  const toolsAddr = await deployProxy(creationCode, source.impls.tools, toolsInit, wallet, overrides);

  const registry = new ethers.Contract(registryAddr, registryAbi, wallet);
  const feeRouter = new ethers.Contract(feeRouterAddr, feeRouterAbi, wallet);
  const createDeployer = new ethers.Contract(deployerAddr, deployerAbi, wallet);

  const owner = await registry.owner();
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`new Registry owner is ${owner}, not the deployer`);
  }

  await send("registry.setOpenFourCore", registry, "setOpenFourCore", [coreAddr], protectedSet, overrides);
  await send("registry.setOpenFourTool", registry, "setOpenFourTool", [toolsAddr], protectedSet, overrides);
  await send("registry.setCreateDeployer", registry, "setCreateDeployer", [deployerAddr], protectedSet, overrides);
  await send("feeRouter.setCore", feeRouter, "setCore", [coreAddr], protectedSet, overrides);
  await send("createDeployer.setCore", createDeployer, "setCore", [coreAddr], protectedSet, overrides);
  await send("feeRouter.setFeeConfig", feeRouter, "setFeeConfig", [source.feeConfig], protectedSet, overrides);
  if (process.env.REBATE_ADDRESS && process.env.REBATE_ADDRESS.trim() !== "") {
    await send(
      "feeRouter.setRebate",
      feeRouter,
      "setRebate",
      [ethers.getAddress(process.env.REBATE_ADDRESS.trim())],
      protectedSet,
      overrides
    );
  }

  await send(
    "registry.upsertTokenImpl",
    registry,
    "upsertTokenImpl",
    [source.preset.tokenImplId, source.tokenImpl.address, source.tokenImpl.version || "1"],
    protectedSet,
    overrides
  );

  const moduleBeacons = {};
  for (const mod of source.modules) {
    await send(
      `registry.upsertModule ${mod.name}`,
      registry,
      "upsertModule",
      [
        mod.moduleId,
        mod.implementation,
        mod.kind,
        {
          moduleId: mod.moduleId,
          version: mod.version || "1.0.0",
          name: mod.name,
          description: mod.description || `${mod.name} module`,
          author: wallet.address,
          feeShareBps: mod.feeShareBps,
        },
        mod.active,
      ],
      protectedSet,
      overrides
    );
    moduleBeacons[mod.name] = ethers.getAddress(await registry.getModuleBeacon(mod.moduleId));
    if (moduleBeacons[mod.name].toLowerCase() === mod.sourceBeacon.toLowerCase()) {
      throw new Error(`${mod.name} reused the source beacon; the new Registry should deploy its own beacon`);
    }
  }

  await send(
    "registry.upsertPreset",
    registry,
    "upsertPreset",
    [
      {
        ...source.preset,
        id: source.presetId,
        author: presetAuthor,
      },
    ],
    protectedSet,
    overrides
  );

  if (source.presetFee) {
    await send(
      "feeRouter.setPresetFeeConfig",
      feeRouter,
      "setPresetFeeConfig",
      [source.presetId, source.presetFee],
      protectedSet,
      overrides
    );
  }

  const out = {
    network: deployment.network || "fork",
    chainId: Number(network.chainId),
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    forkedFrom: deploymentPath,
    source: source.source,
    reusedImplementations: source.impls,
    config: {
      treasury,
      signer,
      presetAuthor,
      wbnb: source.wrappedNative,
      feeConfig: source.feeConfig,
    },
    addresses: {
      registry: registryAddr,
      feeRouter: feeRouterAddr,
      core: coreAddr,
      createDeployer: deployerAddr,
      tools: toolsAddr,
      wbnb: source.wrappedNative,
      tokenImpl: source.tokenImpl.address,
      validator: source.preset.validator,
    },
    moduleIds: Object.fromEntries(source.modules.map((mod) => [mod.name, mod.moduleId])),
    moduleImplementations: Object.fromEntries(source.modules.map((mod) => [mod.name, mod.implementation])),
    beacons: moduleBeacons,
    presets: { bondingV1: source.presetId.toString() },
  };

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "fork-deployment.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(out, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2)
  );
  console.log(`done. new Registry ${registryAddr}`);
  console.log(`addresses written to ${outPath}`);
}

module.exports = { splitErc1967DeployInput };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
  });
}
