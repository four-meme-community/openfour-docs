const path = require("path");
const {
  ERC20_ABI,
  VAULT_ABI,
  appendWorkbenchToken,
  connectFork,
  loadRegistration,
  outDir,
  parseCreatedToken,
  signCreate,
  writeJson,
} = require("./lib/demo");
const { encodeCreateArgs, fetchPresetSchemas, flattenCreateForm, readBaseField } = require("./lib/schema");
const { presetAmounts, loadPreset } = require("./lib/preset");

function formatUnits(value) {
  return `${value} (${value / (10n ** 18n)} tokens / 1e18)`;
}

async function snapshotVault(hre, vaultAddress) {
  const vault = await hre.ethers.getContractAt(VAULT_ABI, vaultAddress);
  return {
    remainingForSale: await vault.remainingForSale(),
    totalRaised: await vault.totalRaised(),
    phase: Number(await vault.phase()),
  };
}

async function main() {
  const hre = require("hardhat");
  const { preset, slug } = loadPreset();
  const amounts = presetAmounts(preset);
  const ctx = await connectFork(hre);
  const { signer, chainId, core, tools, addresses, overrides } = ctx;
  const { registration, path: registrationFile } = loadRegistration(slug);
  if (String(registration.registry).toLowerCase() !== String(addresses.registry).toLowerCase()) {
    throw new Error("Registration file Registry does not match the current fork");
  }

  const presetId = BigInt(process.env.PRESET_ID || registration.presetId);
  const quoteAsset = hre.ethers.getAddress(process.env.QUOTE_ASSET || addresses.wbnb || (await core.wrappedNative()));
  const wrappedNative = hre.ethers.getAddress(addresses.wbnb || (await core.wrappedNative()));
  const createFee = BigInt(process.env.CREATE_FEE || "0");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const requestId = BigInt(process.env.REQUEST_ID || Date.now());
  const form = flattenCreateForm(preset.create, {
    name: process.env.TOKEN_NAME,
    symbol: process.env.TOKEN_SYMBOL,
    duration: process.env.DURATION,
  });

  const schemas = await fetchPresetSchemas(tools, presetId);
  const createArgs = encodeCreateArgs({
    requestId,
    presetId,
    validTimestamp: now + 3600n,
    createFee,
    presaleQuote: 0n,
    quoteAsset,
    form,
    schemas,
  });
  const { caller, digest, signature } = await signCreate(signer, chainId, createArgs);
  const txValue = createFee;

  try {
    await core.createToken.staticCall(createArgs, signature, { ...overrides, value: txValue });
  } catch (err) {
    throw new Error(`createToken precheck failed: ${err.shortMessage || err.message}`);
  }

  const createTx = await core.createToken(createArgs, signature, { ...overrides, value: txValue });
  const createRec = await createTx.wait();
  if (!createRec || createRec.status !== 1) throw new Error("createToken failed");
  const tokenAddress = parseCreatedToken(createRec, core);
  const runtime = await core.tokens(tokenAddress);
  if (!runtime.exists) throw new Error("Core.tokens(token).exists is false after create");

  const tokenRecord = {
    tokenAddress,
    name: form.name,
    symbol: form.symbol,
    presetId: presetId.toString(),
    presetName: preset.name,
    creator: caller,
    txHash: createRec.hash || createTx.hash,
    chainId,
    quoteAsset,
    createdAt: new Date().toISOString(),
    digest,
  };
  appendWorkbenchToken(tokenRecord);

  const afterCreate = await snapshotVault(hre, runtime.vault);
  console.log(JSON.stringify({
    created: tokenAddress,
    presetId: presetId.toString(),
    saleAmount: readBaseField(form, "saleAmount", 18).toString(),
    raiseAmount: readBaseField(form, "raiseAmount", 18).toString(),
    vault: afterCreate,
  }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  const buyEst = await tools.estimateBuy.staticCall(tokenAddress, caller, amounts.buyAmount, 0n, "0x");
  const maxPay = (buyEst.userPays * 10500n) / 10000n;
  const nativeBuy = quoteAsset.toLowerCase() === wrappedNative.toLowerCase();
  if (!nativeBuy) {
    const quote = await hre.ethers.getContractAt(ERC20_ABI, quoteAsset, signer);
    const allowance = await quote.allowance(caller, await core.getAddress());
    if (allowance < maxPay) {
      const approveTx = await quote.approve(await core.getAddress(), hre.ethers.MaxUint256, overrides);
      await approveTx.wait();
    }
  }
  const buyTx = await core.buy(
    tokenAddress,
    amounts.buyAmount,
    maxPay,
    0n,
    "0x",
    { ...overrides, value: nativeBuy ? maxPay : 0n },
  );
  const buyRec = await buyTx.wait();
  if (!buyRec || buyRec.status !== 1) throw new Error("buy failed");

  const afterBuy = await snapshotVault(hre, runtime.vault);
  const token = await hre.ethers.getContractAt(ERC20_ABI, tokenAddress, signer);
  const balanceAfterBuy = await token.balanceOf(caller);
  console.log(JSON.stringify({
    buy: amounts.buyAmount.toString(),
    userPays: buyEst.userPays.toString(),
    txHash: buyRec.hash || buyTx.hash,
    balance: formatUnits(balanceAfterBuy),
    vault: afterBuy,
  }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  const doSell = preset.loop?.sell !== false
    && preset.create?.curve?.enableSell !== false
    && amounts.sellAmount > 0n;
  let sellAmount = 0n;
  let sellTxHash = "";
  if (doSell) {
    sellAmount = balanceAfterBuy < amounts.sellAmount ? balanceAfterBuy : amounts.sellAmount;
    if (sellAmount === 0n) throw new Error("token balance is 0 after buy; cannot sell");
    const sellAllowance = await token.allowance(caller, await core.getAddress());
    if (sellAllowance < sellAmount) {
      const approveTx = await token.approve(await core.getAddress(), hre.ethers.MaxUint256, overrides);
      await approveTx.wait();
    }
    const sellEst = await tools.estimateSell.staticCall(tokenAddress, caller, sellAmount, 0n, "0x");
    const minOut = (sellEst.userReceives * 9500n) / 10000n;
    const sellTx = await core.sell(tokenAddress, sellAmount, minOut, 0n, "0x", overrides);
    const sellRec = await sellTx.wait();
    if (!sellRec || sellRec.status !== 1) throw new Error("sell failed");
    sellTxHash = sellRec.hash || sellTx.hash;
  } else {
    console.log("sell skipped");
  }

  const afterSell = await snapshotVault(hre, runtime.vault);
  const balanceAfterSell = await token.balanceOf(caller);
  let migrate = {
    skipped: true,
    note: "Call migrate after timeout/sellout, or rerun with DURATION=0 MIGRATE=1.",
  };
  if (process.env.MIGRATE === "1") {
    const migrateTx = await core.migrate(tokenAddress, overrides);
    const migrateRec = await migrateTx.wait();
    if (!migrateRec || migrateRec.status !== 1) throw new Error("migrate failed");
    migrate = {
      skipped: false,
      txHash: migrateRec.hash || migrateTx.hash,
      vault: await snapshotVault(hre, runtime.vault),
    };
  }
  const result = {
    preset: slug,
    tokenAddress,
    presetId: presetId.toString(),
    createTx: createRec.hash || createTx.hash,
    buyTx: buyRec.hash || buyTx.hash,
    sellTx: sellTxHash || undefined,
    bought: amounts.buyAmount.toString(),
    sold: sellAmount.toString(),
    balance: balanceAfterSell.toString(),
    vault: afterSell,
    migrate,
    workbench: "Token appended to developer/workbench/data/tokens.json",
    registration: registrationFile,
  };
  writeJson(path.join(outDir(), `${slug}-create-and-trade.json`), result);
  console.log(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
