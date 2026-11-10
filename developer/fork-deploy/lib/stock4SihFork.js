/**
 * Stock4 SIH wiring for a developer fork:
 * - deploy a per-fork sandbox SIH set (hook + hookOwner + monitor); deployer is admin
 * - deploy Stock4SihManager bound to the fork Core + Stock4SihTokenHelper
 * - wire CONFIG / CREATOR / WITHDRAW + monitor.setOperator
 * - deploy PancakeSwapV4SihMigrateModule(manager) for upsertModule
 *
 * Artifacts are abi + creation bytecode only (no Solidity sources).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ARTIFACTS = path.join(__dirname, "../artifacts");
const BSCTESTNET_POOL_MANAGER = "0x36A12c70c9Cf64f24E89ee132BF93Df2DCD199d4";

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
  "function setRequireEnabledConfig(bool required)",
];

const monitorAbi = [
  "function owner() view returns (address)",
  "function setOperator(address account, bool allowed)",
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

/** Deploy hook impl + ERC1967 proxy + hookOwner + monitor; deployer is admin/owner. */
async function deploySandboxSihSet(wallet, poolManager, overrides = {}) {
  const me = wallet.address;
  const pm = ethers.getAddress(poolManager);
  const hookArt = loadArtifact("CLSharedInventoryHook.json");
  const ownerArt = loadArtifact("CLSharedInventoryHookOwner.json");
  const monitorArt = loadArtifact("CLSharedInventoryHookMonitor.json");
  const proxyArt = loadArtifact("ERC1967Proxy.json");

  console.log(`  stock4 SIH: sandbox hook impl (poolManager=${pm})`);
  const implFactory = new ethers.ContractFactory(hookArt.abi, hookArt.bytecode, wallet);
  const impl = await implFactory.deploy(pm, me, overrides);
  await impl.waitForDeployment();
  const hookImpl = await impl.getAddress();

  const initData = implFactory.interface.encodeFunctionData("initialize", [me]);
  const proxyFactory = new ethers.ContractFactory(proxyArt.abi, proxyArt.bytecode, wallet);
  const proxy = await proxyFactory.deploy(hookImpl, initData, overrides);
  await proxy.waitForDeployment();
  const hook = await proxy.getAddress();
  const hookContract = new ethers.Contract(hook, hookArt.abi, wallet);
  console.log(`  stock4 SIH: sandbox hook ${hook} (impl ${hookImpl})`);

  const ownerFactory = new ethers.ContractFactory(ownerArt.abi, ownerArt.bytecode, wallet);
  const hookOwnerC = await ownerFactory.deploy(hook, me, me, overrides);
  await hookOwnerC.waitForDeployment();
  const hookOwner = await hookOwnerC.getAddress();
  console.log(`  stock4 SIH: sandbox hookOwner ${hookOwner}`);

  const monFactory = new ethers.ContractFactory(monitorArt.abi, monitorArt.bytecode, wallet);
  const monitorC = await monFactory.deploy(hook, overrides);
  await monitorC.waitForDeployment();
  const monitor = await monitorC.getAddress();
  console.log(`  stock4 SIH: sandbox monitor ${monitor}`);

  const txOwn = await hookContract.transferOwnership(hookOwner, overrides);
  await txOwn.wait();
  if ((await hookContract.owner()).toLowerCase() !== hookOwner.toLowerCase()) {
    throw new Error("sandbox SIH: hook ownership handoff failed");
  }
  const owner = new ethers.Contract(hookOwner, hookOwnerAbi, wallet);
  const txCfg = await owner.setRequireEnabledConfig(true, overrides);
  await txCfg.wait();

  return { hook, hookImpl, hookOwner, monitor };
}

async function wireHookRoles(wallet, hookOwnerAddr, monitorAddr, managerAddr, overrides) {
  const hookOwner = new ethers.Contract(hookOwnerAddr, hookOwnerAbi, wallet);
  const monitor = new ethers.Contract(monitorAddr, monitorAbi, wallet);
  for (const roleName of ["CONFIG_ROLE", "CREATOR_ROLE", "WITHDRAW_ROLE"]) {
    const role = await hookOwner[roleName]();
    if (!(await hookOwner.hasRole(role, managerAddr))) {
      const tx = await hookOwner.grantRole(role, managerAddr, overrides);
      await tx.wait();
    }
  }
  const txRecipients = await hookOwner.setWithdrawRecipient([managerAddr], [true], overrides);
  await txRecipients.wait();
  const txOp = await monitor.setOperator(managerAddr, true, overrides);
  await txOp.wait();
}

/**
 * @param {object} args
 * @param {ethers.Wallet} args.wallet
 * @param {address} args.coreAddr  fork OpenFourCore
 * @param {object} args.stock4Sih  from source JSON (`quotes`, optional `poolManager` / `extraSihRoutes`)
 * @param {object} [args.overrides]
 */
async function setupStock4SihForCore({ wallet, coreAddr, stock4Sih, overrides = {} }) {
  const quotes = (stock4Sih?.quotes || []).map((q) => ethers.getAddress(q));
  if (quotes.length === 0) throw new Error("source.stock4Sih.quotes is empty");

  const poolManager =
    stock4Sih.poolManager || process.env.SIH_POOL_MANAGER || BSCTESTNET_POOL_MANAGER;
  const set = await deploySandboxSihSet(wallet, poolManager, overrides);
  const { hookOwner: hookOwnerAddr, monitor: monitorAddr, hook: hookAddr, hookImpl } = set;

  console.log(`  stock4 SIH: deploy Stock4SihManager for Core ${coreAddr}`);
  const { proxy: managerAddr, impl: managerImpl, contract: manager } = await deployUUPS(
    wallet,
    "Stock4SihManager.json",
    [coreAddr],
    overrides
  );
  console.log(`  stock4 SIH: manager ${managerAddr} (impl ${managerImpl})`);

  await wireHookRoles(wallet, hookOwnerAddr, monitorAddr, managerAddr, overrides);
  console.log("  stock4 SIH: hook roles + monitor operator granted");

  // Minimal graduation: meme/Stock4 only (no shared converter / bStock cutover).
  for (const quote of quotes) {
    console.log(`  stock4 SIH: setSihSet ${quote} (sandbox hook, no converter)`);
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

  console.log("  stock4 SIH: deploy sandbox Stock4SihTokenHelper");
  const helper = await deployUUPS(wallet, "Stock4SihTokenHelper.json", [managerAddr], overrides);
  const taxLiquidityHelper = helper.proxy;
  {
    const tx = await manager.setTaxLiquidityHelper(taxLiquidityHelper, overrides);
    await tx.wait();
  }
  console.log(`  stock4 SIH: taxLiquidityHelper ${taxLiquidityHelper}`);

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
    hook: hookAddr,
    hookImpl,
    taxLiquidityHelper,
    quotes,
    sandbox: true,
    rolesWired: true,
  };
}

module.exports = {
  setupStock4SihForCore,
  deploySandboxSihSet,
  BSCTESTNET_POOL_MANAGER,
};
