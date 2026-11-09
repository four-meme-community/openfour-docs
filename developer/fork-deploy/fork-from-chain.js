/**
 * Fork a new proxy set from source/bsctestnet.json.
 *
 * Does not compile or deploy OpenFour implementations. New proxies point at
 * the implementations already referenced by that address list. Copies Bonding +
 * Bonding Tax (Royalty) modules / presets, and wires TaxVaultRegistry
 * (ForwardVault) when the source has one.
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
const { setupStock4SihForCore } = require("./lib/stock4SihFork");

dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, ".env") });

const ERC1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// Creation tx whose init code is reused for new ERC-1967 proxies on this toolkit.
const DEFAULT_PROXY_DEPLOY_TX =
  "0xc5e66936272ac4779c5c8388becbd86b0569a42b9ace144b174d0a5428b4620e";

const MODULES = [
  ["TOKEN_STANDARD", 0],
  ["VAULT_BASIC", 1],
  ["CURVE_BONDING", 2],
  ["TRADE_SIMPLE", 3],
  ["MIGRATE_BONDING", 4],
  // Royalty / unverified ForwardVault path (Bonding Tax)
  ["TOKEN_TAX", 0],
  ["VAULT_TAX_BONDING", 1],
  ["TRADE_TAX_BONDING", 3],
  ["MIGRATE_BONDING_TAX", 4],
  // Stock4 Tax + ForwardVault create / bonding-tax path
  ["TOKEN_TAX_STOCK", 0],
  ["MIGRATE_BONDING_TAX_PCS_SIH", 4],
];

const FORWARD_VAULT_TYPE_ID = ethers.keccak256(ethers.toUtf8Bytes("SafuSkill.ForwardVault.v1"));

const registryAbi = [
  "function initialize()",
  "function owner() view returns (address)",
  "function getModule(bytes32 moduleKey) view returns (tuple(address beacon, uint8 kind, tuple(bytes32 moduleId, string version, string name, string description, address author, uint16 feeShareBps) metadata, bool active))",
  "function getModuleImplementation(bytes32 moduleKey) view returns (address)",
  "function getPreset(uint256 presetId) view returns (tuple(uint256 id, string name, string description, string version, bool active, bool createEnabled, address validator, bytes32 tokenModuleId, bytes32 vaultModuleId, bytes32 curveModuleId, bytes32 tradeModuleId, bytes32 migrateModuleId, bytes32 tokenImplId, bytes32 customDataId, address author))",
  "function getTokenImpl(bytes32 tokenImplId) view returns (tuple(address implementation, string version))",
  "function taxVaultRegistry() view returns (address)",
  "function setTaxVaultRegistry(address registry_)",
  "function setOpenFourCore(address core)",
  "function setOpenFourTool(address tool)",
  "function setCreateDeployer(address deployer)",
  "function upsertModule(bytes32 moduleKey, address implementation, uint8 kind, tuple(bytes32 moduleId, string version, string name, string description, address author, uint16 feeShareBps) metadata, bool active)",
  "function upsertTokenImpl(bytes32 tokenImplId, address implementation, string version)",
  "function upsertPreset(tuple(uint256 id, string name, string description, string version, bool active, bool createEnabled, address validator, bytes32 tokenModuleId, bytes32 vaultModuleId, bytes32 curveModuleId, bytes32 tradeModuleId, bytes32 migrateModuleId, bytes32 tokenImplId, bytes32 customDataId, address author) preset)",
  "function getModuleBeacon(bytes32 moduleKey) view returns (address)",
];

const taxVaultRegistryAbi = [
  "function getVaultTypeImplementation(bytes32 typeId) view returns (address)",
  "function getVaultType(bytes32 typeId) view returns (tuple(address beacon, address implementation, string name, string version, string description, bool active))",
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

function loadPresetEntries(deployment) {
  const presets = deployment.presets || {};
  const entries = Object.entries(presets).filter(([, id]) => id !== undefined && id !== null && String(id) !== "");
  if (entries.length === 0) {
    throw new Error("deployment JSON has no presets; need at least bondingV1");
  }
  return entries.map(([name, id]) => ({ name, id: BigInt(id) }));
}

async function readModule(registry, provider, name, expectedKind) {
  const moduleId = ethers.keccak256(ethers.toUtf8Bytes(name));
  const rec = await registry.getModule(moduleId);
  if (rec.beacon === ethers.ZeroAddress) {
    return null;
  }
  if (BigInt(rec.kind) !== BigInt(expectedKind)) {
    throw new Error(`${name} kind is ${rec.kind}, expected ${expectedKind}`);
  }
  const implementation = ethers.getAddress(await registry.getModuleImplementation(moduleId));
  await requireCode(provider, name, implementation);
  return {
    name,
    moduleId,
    kind: Number(expectedKind),
    implementation,
    sourceBeacon: ethers.getAddress(rec.beacon),
    version: rec.metadata.version,
    description: rec.metadata.description,
    feeShareBps: Number(rec.metadata.feeShareBps),
    active: Boolean(rec.active),
  };
}

async function readPresetBundle(registry, feeRouter, provider, presetName, presetId, modulesById) {
  const preset = await registry.getPreset(presetId);
  if (preset.id === 0n) throw new Error(`source Registry has no preset ${presetName}=${presetId}`);

  const slotFields = [
    ["tokenModuleId", 0],
    ["vaultModuleId", 1],
    ["curveModuleId", 2],
    ["tradeModuleId", 3],
    ["migrateModuleId", 4],
  ];
  for (const [field, kind] of slotFields) {
    const id = preset[field];
    const mod = modulesById.get(id.toLowerCase());
    if (!mod) {
      throw new Error(`preset ${presetName} ${field}=${id} is not among forked modules; check source/bsctestnet.json`);
    }
    if (mod.kind !== kind) {
      throw new Error(`preset ${presetName} ${field} module kind ${mod.kind} != ${kind}`);
    }
  }

  const tokenImpl = await registry.getTokenImpl(preset.tokenImplId);
  const tokenImplAddress = ethers.getAddress(tokenImpl.implementation);
  if (tokenImplAddress === ethers.ZeroAddress) {
    throw new Error(`preset ${presetName} tokenImplId ${preset.tokenImplId} has no implementation`);
  }
  await requireCode(provider, `${presetName} tokenImpl`, tokenImplAddress);

  let validator = ethers.getAddress(preset.validator);
  if (validator !== ethers.ZeroAddress) {
    const validatorCode = await provider.getCode(validator);
    if (!validatorCode || validatorCode === "0x") validator = ethers.ZeroAddress;
  }

  if (preset.customDataId !== ethers.ZeroHash) {
    console.log(`preset ${presetName} has customData; fork keeps customDataId but does not copy a CustomData module`);
  }

  const presetFee = await feeRouter.presetFeeConfig(presetId);
  return {
    key: presetName,
    id: preset.id,
    name: preset.name,
    description: preset.description,
    version: preset.version,
    active: preset.active,
    createEnabled: preset.createEnabled,
    validator,
    tokenModuleId: preset.tokenModuleId,
    vaultModuleId: preset.vaultModuleId,
    curveModuleId: preset.curveModuleId,
    tradeModuleId: preset.tradeModuleId,
    migrateModuleId: preset.migrateModuleId,
    tokenImplId: preset.tokenImplId,
    customDataId: preset.customDataId,
    tokenImpl: { address: tokenImplAddress, version: tokenImpl.version || "1" },
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
  };
}

async function readSource(provider, deployment) {
  const A = deployment.addresses;
  for (const key of ["registry", "feeRouter", "core", "createDeployer", "tools"]) {
    if (!A[key]) throw new Error(`deployment JSON missing addresses.${key}`);
    A[key] = ethers.getAddress(A[key]);
  }

  const presetEntries = loadPresetEntries(deployment);
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
    const listed = deployment.moduleIds?.[name];
    const moduleId = ethers.keccak256(ethers.toUtf8Bytes(name));
    if (listed && listed.toLowerCase() !== moduleId.toLowerCase()) {
      throw new Error(`${name} moduleId does not match deployment JSON`);
    }
    const mod = await readModule(registry, provider, name, expectedKind);
    if (!mod) {
      const needsBondingTax = presetEntries.some((row) => /bondingTax|royalty/i.test(row.name));
      const needsStock4 = presetEntries.some((row) => /stock4/i.test(row.name));
      const isBondingTaxOnly =
        name === "TOKEN_TAX" || name === "MIGRATE_BONDING_TAX";
      const isStock4Only =
        name === "TOKEN_TAX_STOCK" || name === "MIGRATE_BONDING_TAX_PCS_SIH";
      const isSharedTax =
        name === "VAULT_TAX_BONDING" || name === "TRADE_TAX_BONDING";
      if (isBondingTaxOnly) {
        if (needsBondingTax) throw new Error(`source Registry has not registered ${name} (required for Bonding Tax / Royalty)`);
        console.log(`skip module ${name} (not on source)`);
        continue;
      }
      if (isStock4Only) {
        if (needsStock4) throw new Error(`source Registry has not registered ${name} (required for Stock4 Tax)`);
        console.log(`skip module ${name} (not on source)`);
        continue;
      }
      if (isSharedTax) {
        if (needsBondingTax || needsStock4) {
          throw new Error(`source Registry has not registered ${name} (required for tax presets)`);
        }
        console.log(`skip module ${name} (not on source)`);
        continue;
      }
      throw new Error(`source Registry has not registered ${name}`);
    }
    modules.push(mod);
  }

  const modulesById = new Map(modules.map((mod) => [mod.moduleId.toLowerCase(), mod]));
  const presets = [];
  for (const row of presetEntries) {
    presets.push(await readPresetBundle(registry, feeRouter, provider, row.name, row.id, modulesById));
  }

  const tokenImpls = [];
  const seenToken = new Set();
  for (const preset of presets) {
    const key = preset.tokenImplId.toLowerCase();
    if (seenToken.has(key)) continue;
    seenToken.add(key);
    tokenImpls.push({
      tokenImplId: preset.tokenImplId,
      address: preset.tokenImpl.address,
      version: preset.tokenImpl.version,
    });
  }

  let taxVaultRegistry = ethers.ZeroAddress;
  try {
    taxVaultRegistry = ethers.getAddress(await registry.taxVaultRegistry());
  } catch {
    taxVaultRegistry = ethers.ZeroAddress;
  }
  if (A.taxVaultRegistry) {
    taxVaultRegistry = ethers.getAddress(A.taxVaultRegistry);
  }

  let forwardVaultImpl = ethers.ZeroAddress;
  if (taxVaultRegistry !== ethers.ZeroAddress) {
    await requireCode(provider, "taxVaultRegistry", taxVaultRegistry);
    const tvr = new ethers.Contract(taxVaultRegistry, taxVaultRegistryAbi, provider);
    try {
      forwardVaultImpl = ethers.getAddress(await tvr.getVaultTypeImplementation(FORWARD_VAULT_TYPE_ID));
    } catch {
      forwardVaultImpl = ethers.ZeroAddress;
    }
    if (forwardVaultImpl === ethers.ZeroAddress) {
      console.log("taxVaultRegistry has no SafuSkill.ForwardVault.v1 implementation");
    } else {
      await requireCode(provider, "ForwardVault", forwardVaultImpl);
    }
  }

  const feeConfig = await feeRouter.feeConfig();
  const wrappedNative = ethers.getAddress(await core.wrappedNative());
  await requireCode(provider, "wrapped native", wrappedNative);

  return {
    source: A,
    impls,
    modules,
    presets,
    tokenImpls,
    taxVaultRegistry,
    forwardVaultImpl,
    forwardVaultTypeId: FORWARD_VAULT_TYPE_ID,
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
  if (/api[_-]?key|apikey|token=|private/i.test(rpc) || /\/\/[^/]*:[^@/]+@/.test(rpc)) {
    throw new Error("Do not use a private RPC URL in this toolkit. Use https://bsc-testnet.publicnode.com (or another public RPC).");
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
  console.log(
    `taxVaultRegistry=${source.taxVaultRegistry} forwardVaultImpl=${source.forwardVaultImpl}`
  );
  for (const mod of source.modules) {
    console.log(`module ${mod.name} impl=${mod.implementation} beacon=${mod.sourceBeacon} active=${mod.active}`);
  }
  for (const preset of source.presets) {
    console.log(
      `preset ${preset.key} ${preset.id} ${preset.name} tokenImpl=${preset.tokenImpl.address} validator=${preset.validator}`
    );
  }

  const wantsStock4Sih = source.presets.some((row) => row.key === "stock4TaxV1") && deployment.stock4Sih;
  if (wantsStock4Sih) {
    console.log(
      `stock4 SIH: on fork will deploy Manager(Core)+Migrate, reuse hookOwner=${deployment.stock4Sih.hookOwner} quotes=${(deployment.stock4Sih.quotes || []).join(",")}`
    );
  }

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

  if (source.taxVaultRegistry && source.taxVaultRegistry !== ethers.ZeroAddress) {
    await send(
      "registry.setTaxVaultRegistry",
      registry,
      "setTaxVaultRegistry",
      [source.taxVaultRegistry],
      protectedSet,
      overrides
    );
  }

  for (const tokenImpl of source.tokenImpls) {
    await send(
      `registry.upsertTokenImpl ${tokenImpl.tokenImplId}`,
      registry,
      "upsertTokenImpl",
      [tokenImpl.tokenImplId, tokenImpl.address, tokenImpl.version || "1"],
      protectedSet,
      overrides
    );
  }

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

  for (const preset of source.presets) {
    await send(
      `registry.upsertPreset ${preset.key}`,
      registry,
      "upsertPreset",
      [
        {
          id: preset.id,
          name: preset.name,
          description: preset.description,
          version: preset.version,
          active: preset.active,
          createEnabled: preset.createEnabled,
          validator: preset.validator,
          tokenModuleId: preset.tokenModuleId,
          vaultModuleId: preset.vaultModuleId,
          curveModuleId: preset.curveModuleId,
          tradeModuleId: preset.tradeModuleId,
          migrateModuleId: preset.migrateModuleId,
          tokenImplId: preset.tokenImplId,
          customDataId: preset.customDataId,
          author: presetAuthor,
        },
      ],
      protectedSet,
      overrides
    );
    if (preset.presetFee) {
      await send(
        `feeRouter.setPresetFeeConfig ${preset.key}`,
        feeRouter,
        "setPresetFeeConfig",
        [preset.id, preset.presetFee],
        protectedSet,
        overrides
      );
    }
  }

  let stock4SihOut;
  if (wantsStock4Sih) {
    stock4SihOut = await setupStock4SihForCore({
      wallet,
      coreAddr,
      stock4Sih: deployment.stock4Sih,
      overrides,
    });
    const migrateMod = source.modules.find((m) => m.name === "MIGRATE_BONDING_TAX_PCS_SIH");
    if (!migrateMod) throw new Error("MIGRATE_BONDING_TAX_PCS_SIH missing from forked modules");
    await send(
      "registry.upsertModule MIGRATE_BONDING_TAX_PCS_SIH (fork Manager)",
      registry,
      "upsertModule",
      [
        migrateMod.moduleId,
        stock4SihOut.migrateImpl,
        migrateMod.kind,
        {
          moduleId: migrateMod.moduleId,
          version: migrateMod.version || "1.0.0",
          name: migrateMod.name,
          description: migrateMod.description || "Graduation into shared SIH via fork Manager",
          author: wallet.address,
          feeShareBps: migrateMod.feeShareBps,
        },
        migrateMod.active,
      ],
      protectedSet,
      overrides
    );
    moduleBeacons.MIGRATE_BONDING_TAX_PCS_SIH = ethers.getAddress(
      await registry.getModuleBeacon(migrateMod.moduleId)
    );
    moduleBeacons.MIGRATE_BONDING_TAX_PCS_SIH_IMPL = stock4SihOut.migrateImpl;
  }

  const bonding = source.presets.find((row) => row.key === "bondingV1") || source.presets[0];
  const tax = source.presets.find((row) => row.key === "bondingTaxV1");
  const stock4 = source.presets.find((row) => row.key === "stock4TaxV1");

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
      taxVaultRegistry: source.taxVaultRegistry,
      forwardVaultImpl: source.forwardVaultImpl,
      tokenImpl: bonding.tokenImpl.address,
      taxTokenImpl: tax ? tax.tokenImpl.address : undefined,
      stock4TaxTokenImpl: stock4 ? stock4.tokenImpl.address : undefined,
      validator: bonding.validator,
    },
    moduleIds: Object.fromEntries(source.modules.map((mod) => [mod.name, mod.moduleId])),
    moduleImplementations: Object.fromEntries(
      source.modules.map((mod) => [
        mod.name,
        mod.name === "MIGRATE_BONDING_TAX_PCS_SIH" && stock4SihOut
          ? stock4SihOut.migrateImpl
          : mod.implementation,
      ])
    ),
    beacons: moduleBeacons,
    forwardVaultTypeId: source.forwardVaultTypeId,
    presets: Object.fromEntries(source.presets.map((row) => [row.key, row.id.toString()])),
    stock4Sih: stock4SihOut || undefined,
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
