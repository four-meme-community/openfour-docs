/**
 * Minimal Stock4 SIH wiring for a developer fork / hub Core:
 * - deploy Stock4SihManager bound to this Core
 * - reuse shared hook set (no hook clone)
 * - deploy PancakeSwapV4SihMigrateModule(manager) and return its address for upsertModule
 *
 * Requires the deployer to hold hookOwner DEFAULT_ADMIN_ROLE and own the monitor
 * (or an admin must run wireHookRoles later).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ARTIFACTS = path.join(__dirname, "../artifacts");

function loadArtifact(name) {
  const p = path.join(ARTIFACTS, name);
  if (!fs.existsSync(p)) throw new Error(`missing artifact ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const hookOwnerAbi = [
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function CONFIG_ROLE() view returns (bytes32)",
  "function CREATOR_ROLE() view returns (bytes32)",
  "function WITHDRAW_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function grantRole(bytes32,address)",
  "function setWithdrawRecipient(address[] accounts, bool[] allowed)",
];

const monitorAbi = [
  "function owner() view returns (address)",
  "function setOperator(address account, bool allowed)",
];

const refManagerAbi = [
  "function sihOf(address) view returns (tuple(address hookOwner, address monitor, address bStock, address converter))",
  "function hookOf(address) view returns (address)",
  "function taxLiquidityHelper() view returns (address)",
  "function extraSihRoutes() view returns (address[])",
];

async function deployUUPS(wallet, artifactName, initArgs, overrides) {
  const art = loadArtifact(artifactName);
  const proxyArt = loadArtifact("ERC1967Proxy.json");
  const implFactory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
  const impl = await implFactory.deploy(overrides);
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  const iface = implFactory.interface;
  const initFrag = iface.fragments.find(
    (f) => f.type === "function" && f.name === "initialize" && f.inputs.length === initArgs.length
  );
  if (!initFrag) throw new Error(`${artifactName}: initialize(${initArgs.length}) not found`);
  const initData = iface.encodeFunctionData(initFrag, initArgs);
  const proxyFactory = new ethers.ContractFactory(proxyArt.abi, proxyArt.bytecode, wallet);
  const proxy = await proxyFactory.deploy(implAddr, initData, overrides);
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  return { proxy: proxyAddr, impl: implAddr, contract: new ethers.Contract(proxyAddr, art.abi, wallet) };
}

async function tryWireHookRoles(wallet, hookOwnerAddr, monitorAddr, managerAddr, overrides) {
  const hookOwner = new ethers.Contract(hookOwnerAddr, hookOwnerAbi, wallet);
  const monitor = new ethers.Contract(monitorAddr, monitorAbi, wallet);
  const adminRole = await hookOwner.DEFAULT_ADMIN_ROLE();
  const canAdmin = await hookOwner.hasRole(adminRole, wallet.address);
  if (!canAdmin) {
    return {
      wired: false,
      reason: `deployer lacks hookOwner DEFAULT_ADMIN_ROLE; grant CREATOR/CONFIG/WITHDRAW + monitor.setOperator to ${managerAddr}`,
    };
  }
  for (const roleName of ["CONFIG_ROLE", "CREATOR_ROLE", "WITHDRAW_ROLE"]) {
    const role = await hookOwner[roleName]();
    if (!(await hookOwner.hasRole(role, managerAddr))) {
      const tx = await hookOwner.grantRole(role, managerAddr, overrides);
      await tx.wait();
    }
  }
  const txRecipients = await hookOwner.setWithdrawRecipient([managerAddr], [true], overrides);
  await txRecipients.wait();

  const monOwner = await monitor.owner();
  if (monOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    return {
      wired: false,
      reason: `monitor owner is ${monOwner}; call monitor.setOperator(${managerAddr}, true)`,
    };
  }
  const txOp = await monitor.setOperator(managerAddr, true, overrides);
  await txOp.wait();
  return { wired: true };
}

/**
 * @param {object} args
 * @param {ethers.Wallet} args.wallet
 * @param {address} args.coreAddr  fork/hub OpenFourCore
 * @param {object} args.stock4Sih  from source JSON
 * @param {object} [args.overrides]
 */
async function setupStock4SihForCore({ wallet, coreAddr, stock4Sih, overrides = {} }) {
  if (!stock4Sih?.hookOwner || !stock4Sih?.monitor) {
    throw new Error("source.stock4Sih missing hookOwner/monitor");
  }
  const hookOwnerAddr = ethers.getAddress(stock4Sih.hookOwner);
  const monitorAddr = ethers.getAddress(stock4Sih.monitor);
  const quotes = (stock4Sih.quotes || []).map((q) => ethers.getAddress(q));
  if (quotes.length === 0) throw new Error("source.stock4Sih.quotes is empty");

  console.log(`  stock4 SIH: deploy Stock4SihManager for Core ${coreAddr}`);
  const { proxy: managerAddr, impl: managerImpl, contract: manager } = await deployUUPS(
    wallet,
    "Stock4SihManager.json",
    [coreAddr],
    overrides
  );
  console.log(`  stock4 SIH: manager ${managerAddr} (impl ${managerImpl})`);

  const wire = await tryWireHookRoles(wallet, hookOwnerAddr, monitorAddr, managerAddr, overrides);
  if (!wire.wired) {
    console.log(`  stock4 SIH WARNING: ${wire.reason}`);
  } else {
    console.log("  stock4 SIH: hook roles + monitor operator granted");
  }

  // Minimal graduation: meme/Stock4 only (no shared converter / bStock cutover).
  for (const quote of quotes) {
    console.log(`  stock4 SIH: setSihSet ${quote} (shared hook, no converter)`);
    const tx = await manager.setSihSet(
      quote,
      {
        hookOwner: hookOwnerAddr,
        monitor: monitorAddr,
        bStock: ethers.ZeroAddress,
        converter: ethers.ZeroAddress,
      },
      overrides
    );
    await tx.wait();
  }

  if (stock4Sih.taxLiquidityHelper) {
    const helper = ethers.getAddress(stock4Sih.taxLiquidityHelper);
    const tx = await manager.setTaxLiquidityHelper(helper, overrides);
    await tx.wait();
  }
  if (Array.isArray(stock4Sih.extraSihRoutes) && stock4Sih.extraSihRoutes.length > 0) {
    const routes = stock4Sih.extraSihRoutes.map((a) => ethers.getAddress(a));
    const tx = await manager.setExtraSihRoutes(routes, overrides);
    await tx.wait();
  }

  console.log(`  stock4 SIH: deploy PancakeSwapV4SihMigrateModule(${managerAddr})`);
  const migrateArt = loadArtifact("PancakeSwapV4SihMigrateModule.json");
  const migrateFactory = new ethers.ContractFactory(migrateArt.abi, migrateArt.bytecode, wallet);
  const migrate = await migrateFactory.deploy(managerAddr, overrides);
  await migrate.waitForDeployment();
  const migrateImpl = await migrate.getAddress();
  console.log(`  stock4 SIH: migrate impl ${migrateImpl}`);

  return {
    manager: managerAddr,
    managerImpl,
    migrateImpl,
    hookOwner: hookOwnerAddr,
    monitor: monitorAddr,
    hook: stock4Sih.hook ? ethers.getAddress(stock4Sih.hook) : undefined,
    quotes,
    rolesWired: wire.wired,
    wireWarning: wire.wired ? undefined : wire.reason,
  };
}

/** Read quote SIH sets from a reference manager into source-shaped stock4Sih (optional helper). */
async function readStock4SihFromReference(provider, referenceManager, quotes) {
  const m = new ethers.Contract(ethers.getAddress(referenceManager), refManagerAbi, provider);
  const first = ethers.getAddress(quotes[0]);
  const set = await m.sihOf(first);
  if (set.hookOwner === ethers.ZeroAddress) {
    throw new Error(`reference manager has no SIH set for ${first}`);
  }
  return {
    referenceManager: ethers.getAddress(referenceManager),
    hookOwner: ethers.getAddress(set.hookOwner),
    monitor: ethers.getAddress(set.monitor),
    hook: ethers.getAddress(await m.hookOf(first)),
    taxLiquidityHelper: ethers.getAddress(await m.taxLiquidityHelper()),
    extraSihRoutes: (await m.extraSihRoutes()).map((a) => ethers.getAddress(a)),
    quotes: quotes.map((q) => ethers.getAddress(q)),
  };
}

module.exports = {
  setupStock4SihForCore,
  readStock4SihFromReference,
  tryWireHookRoles,
};
