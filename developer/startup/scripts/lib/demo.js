const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const {
  encodeCreateParams,
  FAIRLAUNCH_OFFLINE_SCHEMAS,
  flattenCreateForm,
} = require("./schema");
const {
  presetAmounts,
  loadPreset,
  moduleKeyFromSource,
  slugify,
  startupRoot,
} = require("./preset");

const TOKEN_UNIT = 10n ** 18n;

function fairLaunchDemoAmounts() {
  return presetAmounts(loadPreset("fairlaunch").preset);
}

const FORBIDDEN_CHAIN_IDS = new Set([56, 4663]);

const REGISTRY_ABI = [
  "function owner() view returns (address)",
  "function openFourCore() view returns (address)",
  "function openFourTool() view returns (address)",
  "function getPreset(uint256 presetId) view returns (tuple(uint256 id, string name, string description, string version, bool active, bool createEnabled, address validator, bytes32 tokenModuleId, bytes32 vaultModuleId, bytes32 curveModuleId, bytes32 tradeModuleId, bytes32 migrateModuleId, bytes32 tokenImplId, bytes32 customDataId, address author))",
  "function getTokenImpl(bytes32 tokenImplId) view returns (tuple(address implementation, string version))",
  "function getModuleImplementation(bytes32 moduleKey) view returns (address)",
  "function upsertModule(bytes32 moduleKey, address implementation, uint8 kind, tuple(bytes32 moduleId, string version, string name, string description, address author, uint16 feeShareBps) metadata, bool active)",
  "function upsertPreset(tuple(uint256 id, string name, string description, string version, bool active, bool createEnabled, address validator, bytes32 tokenModuleId, bytes32 vaultModuleId, bytes32 curveModuleId, bytes32 tradeModuleId, bytes32 migrateModuleId, bytes32 tokenImplId, bytes32 customDataId, address author) preset)",
  "function upsertTokenImpl(bytes32 tokenImplId, address implementation, string version)",
];

const CORE_ABI = [
  "function createToken(bytes createArgs, bytes signature) payable returns (address)",
  "function buy(address token, uint256 amount, uint256 maxQuotePayAmount, uint256 options, bytes proof) payable",
  "function sell(address token, uint256 amount, uint256 minQuoteRecvAmount, uint256 options, bytes proof)",
  "function migrate(address token)",
  "function tokens(address) view returns (uint32 version,address creator,uint256 presetId,address token,string name,string symbol,uint256 maxSupply,uint256 saleAmount,uint256 raiseAmount,address quoteAsset,address vault,address curveModule,address tradeModule,address migrateModule,address tokenModule,address customData,uint256 createBlock,bool exists,bool paused,bool antiSniperEnabled)",
  "function wrappedNative() view returns (address)",
  "function signer() view returns (address)",
  "function registry() view returns (address)",
  "event TokenCreated(uint256 requestId, uint256 indexed presetId, address indexed creator, address indexed token, string name, string symbol, uint256 maxSupply, uint256 saleAmount, uint256 raiseAmount, uint256 initialPrice, address quoteAsset, address vault, address curveModule, address tradeModule, address migrateModule, address customData, address tokenModule, string tokenMetaUri, uint256 flags, bytes encodedTags)",
];

const TOOLS_ABI = [
  "function estimateBuy(address token,address trader,uint256 amount,uint256 options,bytes proof) returns (tuple(uint256 curveQuote, uint256 totalFee, uint256 userPays, uint256 userReceives, uint256 tokenAmount, uint256 executionPrice))",
  "function estimateSell(address token,address trader,uint256 amount,uint256 options,bytes proof) returns (tuple(uint256 curveQuote, uint256 totalFee, uint256 userPays, uint256 userReceives, uint256 tokenAmount, uint256 executionPrice))",
];

const VAULT_ABI = [
  "function remainingForSale() view returns (uint256)",
  "function totalRaised() view returns (uint256)",
  "function phase() view returns (uint8)",
  "function quoteAsset() view returns (address)",
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const FEE_ROUTER_ABI = [
  "function presetFeeConfig(uint256 presetId) view returns (uint16 protocolFeeBps, uint16 developerFeePoolBps, uint16 maxProtocolDevFeeBps, uint16 maxTaxBps, uint8 maxTaxTiers, bool active, uint256 partnerProtocolShareBps)",
  "function setPresetFeeConfig(uint256 presetId, tuple(uint16 protocolFeeBps, uint16 developerFeePoolBps, uint16 maxProtocolDevFeeBps, uint16 maxTaxBps, uint8 maxTaxTiers, bool active, uint256 partnerProtocolShareBps) cfg)",
];

function outDir() {
  return path.join(startupRoot(), "out");
}

function registrationPath(slug) {
  if (process.env.REGISTRATION_JSON) return path.resolve(process.env.REGISTRATION_JSON);
  const name = slugify(slug || process.env.PRESET || "fairlaunch");
  return path.join(outDir(), `${name}-registration.json`);
}

function candidateForkPaths() {
  if (process.env.FORK_JSON && process.env.FORK_JSON.trim()) {
    const raw = process.env.FORK_JSON.trim();
    return [
      path.resolve(raw),
      path.resolve(startupRoot(), raw),
      path.resolve(startupRoot(), "..", raw),
    ];
  }
  return [
    path.resolve(startupRoot(), "../fork-deploy/out/fork-deployment.json"),
    path.resolve(startupRoot(), "../workbench/data/fork.json"),
  ];
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
}

function loadFork() {
  const tried = [];
  for (const filePath of candidateForkPaths()) {
    tried.push(filePath);
    if (fs.existsSync(filePath)) return { fork: loadJson(filePath), path: filePath };
  }
  throw new Error(
    `Fork deployment not found. Run developer/fork-deploy first, then set FORK_JSON or place the file at:\n${tried.join("\n")}`,
  );
}

function loadRegistration(slug) {
  const filePath = registrationPath(slug);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Registration file not found: ${filePath}. Run scripts/register.js first (PRESET=${slug || process.env.PRESET || "fairlaunch"}).`);
  }
  return { registration: loadJson(filePath), path: filePath };
}

function txOverrides(chainId) {
  // BSC Testnet: 0.05 gwei
  if (Number(chainId) === 97) return { gasPrice: 50_000_000n };
  return {};
}

function assertSafeFork(fork, chainId, registryAddress, deployer) {
  if (FORBIDDEN_CHAIN_IDS.has(Number(chainId))) {
    throw new Error(`chainId ${chainId} is a mainnet. Register and trade only on a developer-owned fork.`);
  }
  const registry = String(registryAddress || "").toLowerCase();
  if (!registry || registry === ethers.ZeroAddress.toLowerCase()) {
    throw new Error("Fork Registry address is missing");
  }
  const forkRegistry = String(fork.addresses?.registry || "").toLowerCase();
  if (forkRegistry && forkRegistry !== registry) {
    throw new Error(`Connected Registry ${registryAddress} does not match fork.json ${fork.addresses.registry}`);
  }
  const forkDeployer = String(fork.deployer || "").toLowerCase();
  if (forkDeployer && forkDeployer !== String(deployer).toLowerCase()) {
    throw new Error(`Deployer ${deployer} is not the fork-deploy deployer ${fork.deployer}. Use the same private key.`);
  }
  const forkChainId = Number(fork.chainId);
  if (forkChainId && forkChainId !== Number(chainId)) {
    throw new Error(`fork.json chainId ${forkChainId} does not match the current network ${chainId}`);
  }
}

async function connectFork(hre) {
  const { fork, path: forkPath } = loadFork();
  const [signer] = await hre.ethers.getSigners();
  if (!signer) throw new Error("No deployer account. Set DEPLOYER_PRIVATE_KEY in developer/startup/.env");
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const registryAddress = fork.addresses?.registry;
  assertSafeFork(fork, chainId, registryAddress, signer.address);

  const registry = await hre.ethers.getContractAt(REGISTRY_ABI, registryAddress, signer);
  const owner = await registry.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Registry.owner is ${owner}, not ${signer.address}`);
  }

  const coreAddress = fork.addresses?.core || (await registry.openFourCore());
  const toolsAddress = fork.addresses?.tools || (await registry.openFourTool());
  const core = await hre.ethers.getContractAt(CORE_ABI, coreAddress, signer);
  const tools = await hre.ethers.getContractAt(TOOLS_ABI, toolsAddress, signer);
  const coreSigner = await core.signer();
  if (coreSigner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Core.signer is ${coreSigner}. createToken must be signed by that address.`);
  }

  return {
    fork,
    forkPath,
    signer,
    chainId,
    overrides: txOverrides(chainId),
    registry,
    core,
    tools,
    addresses: {
      registry: registryAddress,
      core: coreAddress,
      tools: toolsAddress,
      feeRouter: fork.addresses?.feeRouter,
      wbnb: fork.addresses?.wbnb || (await core.wrappedNative()),
    },
  };
}

function encodeFairLaunchParams(overrides = {}) {
  const { preset } = loadPreset("fairlaunch");
  const form = flattenCreateForm(preset.create, {
    duration: overrides.duration != null ? String(overrides.duration) : undefined,
    tokenLiquidityAmount: overrides.tokenLiquidityAmount != null ? String(overrides.tokenLiquidityAmount) : undefined,
  });
  return encodeCreateParams(form, FAIRLAUNCH_OFFLINE_SCHEMAS);
}

async function signCreate(signer, chainId, createArgs) {
  const caller = await signer.getAddress();
  const payload = ethers.solidityPacked(
    ["string", "uint256", "address", "bytes32"],
    ["createOpenFourToken", chainId, caller, ethers.keccak256(createArgs)],
  );
  const digest = ethers.keccak256(payload);
  const signature = await signer.signMessage(ethers.getBytes(digest));
  return { caller, digest, signature };
}

function parseCreatedToken(receipt, core) {
  for (const log of receipt.logs || []) {
    try {
      const parsed = core.interface.parseLog(log);
      if (parsed?.name === "TokenCreated") return parsed.args.token;
    } catch {
      /* other contract */
    }
  }
  throw new Error("TokenCreated event not found");
}

function patchWorkbenchFork(forkPath, patch) {
  const workbenchFork = path.resolve(startupRoot(), "../workbench/data/fork.json");
  const targets = new Set([forkPath, workbenchFork].filter((file) => fs.existsSync(file)));
  for (const file of targets) {
    const current = loadJson(file);
    const modules = new Map();
    for (const row of [...(current.developerModules || []), ...(patch.developerModules || [])]) {
      modules.set(String(row.moduleKey || row.keySource).toLowerCase(), row);
    }
    const next = {
      ...current,
      developerModules: [...modules.values()],
      developerPresets: [
        ...(current.developerPresets || []).filter((row) => String(row.id) !== String(patch.preset.id)),
        patch.preset,
      ],
    };
    writeJson(file, next);
  }
}

function appendWorkbenchToken(record) {
  const filePath = path.resolve(startupRoot(), "../workbench/data/tokens.json");
  const current = fs.existsSync(filePath) ? loadJson(filePath) : { tokens: [] };
  const tokens = Array.isArray(current.tokens) ? current.tokens : [];
  writeJson(filePath, {
    tokens: [record, ...tokens.filter((row) => row.tokenAddress?.toLowerCase() !== record.tokenAddress.toLowerCase())],
  });
}

module.exports = {
  get BUY_AMOUNT() { return fairLaunchDemoAmounts().buyAmount; },
  ERC20_ABI,
  FEE_ROUTER_ABI,
  get MAX_SUPPLY() { return fairLaunchDemoAmounts().maxSupply; },
  get RAISE_AMOUNT() { return fairLaunchDemoAmounts().raiseAmount; },
  REGISTRY_ABI,
  get SALE_AMOUNT() { return fairLaunchDemoAmounts().saleAmount; },
  get SELL_AMOUNT() { return fairLaunchDemoAmounts().sellAmount; },
  TOKEN_UNIT,
  VAULT_ABI,
  appendWorkbenchToken,
  connectFork,
  encodeFairLaunchParams,
  loadJson,
  loadRegistration,
  moduleKeyFromSource,
  outDir,
  parseCreatedToken,
  patchWorkbenchFork,
  registrationPath,
  signCreate,
  writeJson,
};
