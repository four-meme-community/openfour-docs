/**
 * Smoke-flow reference for the three built-in presets after `npm run fork`.
 *
 * Not a product SDK / Workbench replacement — fixed demo amounts and minimal tax
 * params so agents can verify create → trade → (auto) migrate end-to-end.
 *
 * Usage (developer/fork-deploy or `npm run create-test-preset` from developer/):
 *   PRESET=bondingV1|bondingTaxV1|stock4TaxV1|all npm run create-test-preset
 *
 * Env:
 *   FORK_JSON            default ./out/fork-deployment.json
 *   RAISE_AMOUNT         default 0.1
 *   BUY_BUDGET           quote budget per buy round (default 3× raise)
 *   SELL=1               partial buy → sell → buy to sell-out
 *   SKIP_BUY=1           create only
 *   FORWARD_VAULT=1      optional (Tax presets): Unverified Royalty ForwardVault
 *   TAX_VAULT_TEMPLATE   required when FORWARD_VAULT=1
 *   TAX_VAULT_INIT_DATA  optional inner initData hex (default 0x)
 *
 * Graduation: sell-out buy usually migrates in-tx (phase → Migrated).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const BNC4 = "0xB179cBFdE44a9960Dd6C88bC3D163d36C65ae7C9";
const FORWARD_VAULT_TYPE_ID = ethers.keccak256(ethers.toUtf8Bytes("SafuSkill.ForwardVault.v1"));
const PRESET_KEYS = ["bondingV1", "bondingTaxV1", "stock4TaxV1"];
const TAX_PRESET_KEYS = new Set(["bondingTaxV1", "stock4TaxV1"]);
const PHASE = ["Created", "Trading", "MigratePending", "Migrated", "Terminal", "SoldOut"];

const PARAM_TUPLE =
  "tuple(string name,string abiType,uint8 decimals,bool optional,string title,string defaultValue,string hint,string minValue,string maxValue)";
const MODULE_SCHEMA = `tuple(string kind,uint8 version,${PARAM_TUPLE}[] params)`;
const coder = ethers.AbiCoder.defaultAbiCoder();

const CORE_ABI = [
  "function createToken(bytes createArgs, bytes signature) payable returns (address)",
  "function buy(address token,uint256 amount,uint256 maxQuotePayAmount,uint256 options,bytes proof) payable",
  "function buyByBudget(address token,uint256 maxPayAmount,uint256 minAmountOut,uint256 options,bytes proof) payable",
  "function sell(address token,uint256 amount,uint256 minQuoteRecvAmount,uint256 options,bytes proof)",
  "function migrate(address token)",
  "function tokens(address) view returns (uint32 version,address creator,uint256 presetId,address token,string name,string symbol,uint256 maxSupply,uint256 saleAmount,uint256 raiseAmount,address quoteAsset,address vault,address curveModule,address tradeModule,address migrateModule,address tokenModule,address customData,uint256 createBlock,bool exists,bool paused,bool antiSniperEnabled)",
  "function wrappedNative() view returns (address)",
  "event TokenCreated(uint256 requestId, uint256 indexed presetId, address indexed creator, address indexed token, string name, string symbol, uint256 maxSupply, uint256 saleAmount, uint256 raiseAmount, uint256 initialPrice, address quoteAsset, address vault, address curveModule, address tradeModule, address migrateModule, address customData, address tokenModule, string tokenMetaUri, uint256 flags, bytes encodedTags)",
];

const TOOLS_ABI = [
  `function getPresetEncodeSchemas(uint256) view returns (${MODULE_SCHEMA},${MODULE_SCHEMA},${MODULE_SCHEMA},${MODULE_SCHEMA},${MODULE_SCHEMA},${MODULE_SCHEMA})`,
  "function estimateBuy(address token,address trader,uint256 amount,uint256 options,bytes proof) returns (tuple(uint256 curveQuote, uint256 totalFee, uint256 userPays, uint256 userReceives, uint256 tokenAmount, uint256 executionPrice))",
  "function estimateBuyByBudget(address token,address trader,uint256 maxQuotePayAmount,uint256 options,bytes proof) returns (tuple(uint256 curveQuote, uint256 totalFee, uint256 userPays, uint256 userReceives, uint256 tokenAmount, uint256 executionPrice))",
  "function estimateSell(address token,address trader,uint256 amount,uint256 options,bytes proof) returns (tuple(uint256 curveQuote, uint256 totalFee, uint256 userPays, uint256 userReceives, uint256 tokenAmount, uint256 executionPrice))",
];

const VAULT_ABI = [
  "function remainingForSale() view returns (uint256)",
  "function totalRaised() view returns (uint256)",
  "function phase() view returns (uint8)",
  "function isSoldOut() view returns (bool)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function deposit() payable",
];

function loadFork() {
  const candidates = [
    process.env.FORK_JSON,
    path.join(__dirname, "out/fork-deployment.json"),
    path.join(__dirname, "../workbench/data/fork.json"),
  ].filter(Boolean);
  for (const p of candidates) {
    const abs = path.resolve(p);
    if (fs.existsSync(abs)) return { fork: JSON.parse(fs.readFileSync(abs, "utf8")), path: abs };
  }
  throw new Error(`fork deployment not found. Run npm run fork first. Tried:\n${candidates.join("\n")}`);
}

function mapParam(p) {
  return {
    name: p.name,
    abiType: p.abiType,
    decimals: Number(p.decimals || 0),
    optional: Boolean(p.optional),
    defaultValue: p.defaultValue || "",
  };
}

function zeroValue(abiType) {
  if (abiType.endsWith("[]")) return [];
  if (abiType === "address") return ethers.ZeroAddress;
  if (abiType === "bool") return false;
  if (abiType === "bytes32") return ethers.ZeroHash;
  if (abiType === "bytes") return "0x";
  if (abiType === "string") return "";
  return 0n;
}

function resolveParam(desc, form) {
  let raw = form[desc.name];
  if (raw == null || String(raw).trim() === "") {
    if (desc.defaultValue != null && String(desc.defaultValue).trim() !== "") raw = desc.defaultValue;
    else if (desc.optional) return zeroValue(desc.abiType);
    else throw new Error(`missing ${desc.name}`);
  }
  const str = String(raw).trim();
  switch (desc.abiType) {
    case "bool":
      return str === "true" || str === "1";
    case "address":
      return str || ethers.ZeroAddress;
    case "string":
      return str;
    case "bytes32":
      return str || ethers.ZeroHash;
    case "bytes":
      return str || "0x";
    default:
      return Number(desc.decimals) > 0 ? ethers.parseUnits(str, desc.decimals) : BigInt(str);
  }
}

function encodeModuleParams(schema, form) {
  if (!schema?.params?.length) return "0x";
  return coder.encode(
    [`(${schema.params.map((p) => p.abiType).join(",")})`],
    [schema.params.map((p) => resolveParam(p, form))],
  );
}

function encodeCreateArgs({ requestId, presetId, validTimestamp, quoteAsset, form, schemas }) {
  return coder.encode(
    [
      "tuple(uint256 requestId,uint256 presetId,uint256 validTimestamp,uint256 createFee,uint256 presaleQuote,bool antiSniperEnabled,address partner,tuple(string name,string symbol,string tokenUri,uint256 maxSupply,uint256 saleAmount,uint256 raiseAmount,address quoteAsset,bytes32 tokenSalt,bytes tokenParams,bytes vaultParams,bytes curveParams,bytes tradeParams,bytes migrateParams,bytes customDataParams) initParams)",
    ],
    [
      [
        requestId,
        presetId,
        validTimestamp,
        0n,
        0n,
        false,
        ethers.ZeroAddress,
        [
          form.name,
          form.symbol,
          form.tokenUri || "",
          ethers.parseUnits(String(form.maxSupply), 18),
          ethers.parseUnits(String(form.saleAmount), 18),
          ethers.parseUnits(String(form.raiseAmount), 18),
          quoteAsset,
          ethers.ZeroHash,
          encodeModuleParams(schemas.token, form),
          encodeModuleParams(schemas.vault, form),
          encodeModuleParams(schemas.curve, form),
          encodeModuleParams(schemas.trade, form),
          encodeModuleParams(schemas.migrate, form),
          encodeModuleParams(schemas.customData, form),
        ],
      ],
    ],
  );
}

async function signCreate(signer, chainId, createArgs) {
  const caller = await signer.getAddress();
  const payload = ethers.solidityPacked(
    ["string", "uint256", "address", "bytes32"],
    ["createOpenFourToken", chainId, caller, ethers.keccak256(createArgs)],
  );
  const digest = ethers.keccak256(payload);
  const signature = await signer.signMessage(ethers.getBytes(digest));
  return { caller, signature };
}

function txOverrides(chainId) {
  if (Number(chainId) === 97) return { gasPrice: 100_000_000n };
  return {};
}

async function ensureQuote(wallet, quote, coreAddr, wbnb, budget, overrides) {
  if (quote.toLowerCase() === wbnb.toLowerCase()) {
    const weth = new ethers.Contract(wbnb, ERC20_ABI, wallet);
    const bal = await weth.balanceOf(wallet.address);
    if (bal < budget) {
      const tx = await weth.deposit({ ...overrides, value: budget - bal });
      await tx.wait();
    }
    if ((await weth.allowance(wallet.address, coreAddr)) < budget) {
      const tx = await weth.approve(coreAddr, ethers.MaxUint256, overrides);
      await tx.wait();
    }
    return;
  }
  const erc = new ethers.Contract(quote, ERC20_ABI, wallet);
  const bal = await erc.balanceOf(wallet.address);
  if (bal < budget) {
    throw new Error(`need ${ethers.formatEther(budget)} quote; balance ${ethers.formatEther(bal)}. For BNC4 see README Get BNC4.`);
  }
  if ((await erc.allowance(wallet.address, coreAddr)) < budget) {
    const tx = await erc.approve(coreAddr, ethers.MaxUint256, overrides);
    await tx.wait();
  }
}

function appendWorkbenchToken(record) {
  const filePath = path.join(__dirname, "../workbench/data/tokens.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const current = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : { tokens: [] };
  const tokens = Array.isArray(current.tokens) ? current.tokens : [];
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        tokens: [
          record,
          ...tokens.filter((row) => row.tokenAddress?.toLowerCase() !== record.tokenAddress.toLowerCase()),
        ],
      },
      null,
      2,
    )}\n`,
  );
}

function resolveForwardVaultParams(key) {
  const enabled = process.env.FORWARD_VAULT === "1";
  if (!enabled) {
    return { enabled: false, taxVaultTypeId: ethers.ZeroHash, taxVaultInitParams: "0x" };
  }
  if (!TAX_PRESET_KEYS.has(key)) {
    throw new Error("FORWARD_VAULT=1 only applies to bondingTaxV1 / stock4TaxV1");
  }
  const template = (process.env.TAX_VAULT_TEMPLATE || "").trim();
  if (!ethers.isAddress(template)) {
    throw new Error("FORWARD_VAULT=1 requires TAX_VAULT_TEMPLATE=<template implementation>");
  }
  const initData = (process.env.TAX_VAULT_INIT_DATA || "0x").trim() || "0x";
  if (!ethers.isHexString(initData)) {
    throw new Error("TAX_VAULT_INIT_DATA must be hex (inner template initData)");
  }
  // Outer ForwardVault params: abi.encode(template, initData)
  const taxVaultInitParams = coder.encode(["(address,bytes)"], [[ethers.getAddress(template), initData]]);
  return {
    enabled: true,
    template: ethers.getAddress(template),
    taxVaultTypeId: FORWARD_VAULT_TYPE_ID,
    taxVaultInitParams,
  };
}

function defaultForm(key, wallet, raiseAmount, forwardVault) {
  const tax = {
    founder: wallet.address,
    buyFeeRate: "100",
    sellFeeRate: "100",
    rateFounder: "100",
    rateHolder: "0",
    rateBurn: "0",
    rateLiquidity: "0",
    minShare: "10000",
    taxVaultTypeId: forwardVault.taxVaultTypeId,
    taxVaultInitParams: forwardVault.taxVaultInitParams,
  };
  const stamp = Date.now().toString().slice(-5);
  if (key === "bondingV1") {
    return {
      name: `B${stamp}`,
      symbol: `B${stamp}`,
      maxSupply: "10000000000",
      saleAmount: "8000000000",
      raiseAmount,
    };
  }
  if (key === "bondingTaxV1") {
    return {
      name: `T${stamp}`,
      symbol: `T${stamp}`,
      maxSupply: "10000000000",
      saleAmount: "8000000000",
      raiseAmount,
      ...tax,
    };
  }
  return {
    name: `S${stamp}`,
    symbol: `S${stamp}`,
    maxSupply: "1000000000",
    saleAmount: "800000000",
    raiseAmount,
    ...tax,
  };
}

async function runOne({ wallet, core, tools, chainId, overrides, fork, key, raiseAmount, buyBudget, doSell, skipBuy }) {
  if (!fork.presets?.[key]) throw new Error(`fork.json missing presets.${key}`);
  const presetId = BigInt(fork.presets[key]);
  const wbnb = ethers.getAddress(fork.addresses.wbnb || (await core.wrappedNative()));
  const quote = key === "stock4TaxV1" ? BNC4 : wbnb;
  const forwardVault = resolveForwardVaultParams(key);
  const form = defaultForm(key, wallet, raiseAmount, forwardVault);

  const [tokenSch, vaultSch, curveSch, tradeSch, migrateSch, customSch] = await tools.getPresetEncodeSchemas(presetId);
  const schemas = {
    token: { params: Array.from(tokenSch.params).map(mapParam) },
    vault: { params: Array.from(vaultSch.params).map(mapParam) },
    curve: { params: Array.from(curveSch.params).map(mapParam) },
    trade: { params: Array.from(tradeSch.params).map(mapParam) },
    migrate: { params: Array.from(migrateSch.params).map(mapParam) },
    customData: { params: Array.from(customSch.params).map(mapParam) },
  };

  const createArgs = encodeCreateArgs({
    requestId: BigInt(Date.now() + Math.floor(Math.random() * 1e6)),
    presetId,
    validTimestamp: BigInt(Math.floor(Date.now() / 1000) + 3600),
    quoteAsset: quote,
    form,
    schemas,
  });
  const { caller, signature } = await signCreate(wallet, chainId, createArgs);

  await core.createToken.staticCall(createArgs, signature, overrides);
  const createTx = await core.createToken(createArgs, signature, overrides);
  const createRec = await createTx.wait();
  if (!createRec || createRec.status !== 1) throw new Error("createToken failed");

  let tokenAddress;
  for (const log of createRec.logs) {
    try {
      const parsed = core.interface.parseLog(log);
      if (parsed?.name === "TokenCreated") tokenAddress = parsed.args.token;
    } catch {
      /* skip */
    }
  }
  if (!tokenAddress) throw new Error("TokenCreated missing");

  appendWorkbenchToken({
    tokenAddress,
    name: form.name,
    symbol: form.symbol,
    presetId: presetId.toString(),
    presetName: key,
    creator: caller,
    txHash: createRec.hash,
    chainId,
    quoteAsset: quote,
    createdAt: new Date().toISOString(),
  });

  const runtime = await core.tokens(tokenAddress);
  const vault = new ethers.Contract(runtime.vault, VAULT_ABI, wallet.provider);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const coreAddr = await core.getAddress();
  const result = {
    preset: key,
    presetId: presetId.toString(),
    token: tokenAddress,
    quote,
    raiseAmount,
    createTx: createRec.hash,
    vault: runtime.vault,
    forwardVault: forwardVault.enabled
      ? { enabled: true, template: forwardVault.template, taxVaultTypeId: FORWARD_VAULT_TYPE_ID }
      : { enabled: false },
  };

  if (skipBuy) {
    result.skipped = "buy";
    return result;
  }

  const budget = ethers.parseUnits(buyBudget, 18);
  await ensureQuote(wallet, quote, coreAddr, wbnb, budget * 2n, overrides);

  let sellTx;
  if (doSell) {
    // Partial buy (~1% of sale) then sell most, before sell-out graduate.
    const partial = ethers.parseUnits(form.saleAmount, 18) / 100n;
    const estBuy = await tools.estimateBuy.staticCall(tokenAddress, caller, partial, 0n, "0x");
    const maxPay = (estBuy.userPays * 10500n) / 10000n;
    await ensureQuote(wallet, quote, coreAddr, wbnb, maxPay, overrides);
    const buyPartial = await core.buy(tokenAddress, partial, maxPay, 0n, "0x", overrides);
    await buyPartial.wait();
    result.partialBuyTx = buyPartial.hash;

    const bal = await token.balanceOf(caller);
    const sellAmount = (bal * 90n) / 100n;
    if (sellAmount > 0n) {
      if ((await token.allowance(caller, coreAddr)) < sellAmount) {
        const a = await token.approve(coreAddr, ethers.MaxUint256, overrides);
        await a.wait();
      }
      const estSell = await tools.estimateSell.staticCall(tokenAddress, caller, sellAmount, 0n, "0x");
      const minOut = (estSell.userReceives * 9500n) / 10000n;
      const sellRec = await (await core.sell(tokenAddress, sellAmount, minOut, 0n, "0x", overrides)).wait();
      sellTx = sellRec.hash;
    }
  }

  let buyTx;
  let rounds = 0;
  while (!(await vault.isSoldOut()) && rounds < 8) {
    rounds += 1;
    const est = await tools.estimateBuyByBudget.staticCall(tokenAddress, caller, budget, 0n, "0x");
    if (est.tokenAmount === 0n || est.userPays === 0n) break;
    const buyRec = await (await core.buyByBudget(tokenAddress, budget, 0n, 0n, "0x", overrides)).wait();
    if (!buyRec || buyRec.status !== 1) throw new Error("buyByBudget failed");
    buyTx = buyRec.hash;
  }

  const phase = Number(await vault.phase());
  const soldOut = await vault.isSoldOut();
  result.sellTx = sellTx;
  result.buyTx = buyTx;
  result.buyRounds = rounds;
  result.vaultState = {
    soldOut,
    phase: PHASE[phase] || String(phase),
    totalRaised: ethers.formatEther(await vault.totalRaised()),
    remainingForSale: (await vault.remainingForSale()).toString(),
  };

  if (phase === 3) {
    result.migrate = { auto: true, note: "sold-out buy already migrated (do not call migrate again)" };
  } else if (soldOut) {
    try {
      await core.migrate.staticCall(tokenAddress, overrides);
      const mig = await (await core.migrate(tokenAddress, overrides)).wait();
      result.migrate = { auto: false, tx: mig.hash };
    } catch (err) {
      result.migrate = { auto: false, error: err.shortMessage || err.message };
    }
  } else {
    result.migrate = { skipped: true, note: "not sold out" };
  }

  return result;
}

async function main() {
  const { fork, path: forkPath } = loadFork();
  const rpc = process.env.RPC_URL || process.env.BSC_TESTNET_RPC_URL || fork.rpcUrl;
  if (!rpc) throw new Error("Set RPC_URL");
  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("Set DEPLOYER_PRIVATE_KEY");

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId === 56 || chainId === 4663) throw new Error(`refusing mainnet chainId ${chainId}`);
  if (fork.chainId && Number(fork.chainId) !== chainId) {
    throw new Error(`fork.json chainId ${fork.chainId} != network ${chainId}`);
  }
  if (fork.deployer && fork.deployer.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`use fork deployer key (${fork.deployer})`);
  }

  const overrides = txOverrides(chainId);
  const core = new ethers.Contract(fork.addresses.core, CORE_ABI, wallet);
  const tools = new ethers.Contract(fork.addresses.tools, TOOLS_ABI, wallet);
  const raiseAmount = process.env.RAISE_AMOUNT || "0.1";
  const buyBudget =
    process.env.BUY_BUDGET ||
    ethers.formatEther(ethers.parseUnits(raiseAmount, 18) * 3n);
  const doSell = process.env.SELL === "1";
  const skipBuy = process.env.SKIP_BUY === "1";
  const raw = (process.env.PRESET || "bondingV1").trim();
  const keys = raw === "all" ? PRESET_KEYS : [raw];
  for (const key of keys) {
    if (!PRESET_KEYS.includes(key)) throw new Error(`PRESET must be one of ${PRESET_KEYS.join("|")}|all`);
  }

  console.log(
    JSON.stringify(
      {
        fork: forkPath,
        core: fork.addresses.core,
        presets: keys,
        raiseAmount,
        buyBudget,
        doSell,
        skipBuy,
        forwardVault: process.env.FORWARD_VAULT === "1",
        taxVaultTemplate: process.env.TAX_VAULT_TEMPLATE || null,
      },
      null,
      2,
    ),
  );

  const results = [];
  for (const key of keys) {
    const row = await runOne({
      wallet,
      core,
      tools,
      chainId,
      overrides,
      fork,
      key,
      raiseAmount,
      buyBudget,
      doSell,
      skipBuy,
    });
    results.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "create-test-preset-result.json");
  fs.writeFileSync(outPath, `${JSON.stringify({ results }, null, 2)}\n`);
  console.log(`wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
