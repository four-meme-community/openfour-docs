const { expect } = require("chai");
const { ethers } = require("hardhat");

const TOKEN_UNIT = 10n ** 18n;
const MAX_SUPPLY = 1_000_000n * TOKEN_UNIT;
const SALE_AMOUNT = 800_000n * TOKEN_UNIT;
const FIXED_PRICE = 10n ** 14n; // 0.0001 quote / token
const RAISE_AMOUNT = (SALE_AMOUNT * FIXED_PRICE) / TOKEN_UNIT;
const MIN_PURCHASE = 1n * TOKEN_UNIT;
const MAX_PURCHASE = 10_000n * TOKEN_UNIT;

const coder = ethers.AbiCoder.defaultAbiCoder();

function encodeCurve() {
  return coder.encode(
    ["tuple(uint256 fixedPrice,uint16 sellPenaltyBps,bool enableSell,uint256 minPurchase,uint256 maxPurchase)"],
    [[FIXED_PRICE, 500, true, MIN_PURCHASE, MAX_PURCHASE]],
  );
}

function encodeTrade(maxPerAddress = 0n) {
  return coder.encode(
    ["tuple(uint256 maxBuyAmount,uint256 maxPerAddress,uint256 maxSellAmount,uint16 buyFeeBps,uint16 sellFeeBps,address feeRecipient)"],
    [[MAX_PURCHASE, maxPerAddress, 5_000n * TOKEN_UNIT, 0, 0, ethers.ZeroAddress]],
  );
}

function tradeContext(token, trader, extras = {}) {
  return {
    token,
    trader,
    amount: MIN_PURCHASE,
    isBuy: true,
    timestamp: 1,
    blockNumber: 1,
    remainingForSale: SALE_AMOUNT,
    totalRaised: 0,
    curveQuote: FIXED_PRICE,
    proof: "0x",
    ...extras,
  };
}

function asTradeResult(result) {
  return {
    allowed: result.allowed,
    minAmount: result.minAmount,
    maxAmount: result.maxAmount,
    fees: result.fees.map((fee) => ({ recipient: fee.recipient, bps: fee.bps })),
    revertData: result.revertData,
  };
}

function encodeMigrate(overrides = {}) {
  const {
    softCap = 40n * TOKEN_UNIT,
    duration = 7n * 24n * 3600n,
    tokenLiquidityAmount = 0n,
    maxQuoteToUse = 0n,
  } = overrides;
  return coder.encode(
    ["tuple(uint256 softCap,uint256 duration,uint256 tokenLiquidityAmount,uint256 maxQuoteToUse)"],
    [[softCap, duration, tokenLiquidityAmount, maxQuoteToUse]],
  );
}

function tokenCreateParams(quoteAsset) {
  return {
    requestId: 1,
    name: "Example Token",
    symbol: "EXM",
    maxSupply: MAX_SUPPLY,
    saleAmount: SALE_AMOUNT,
    raiseAmount: RAISE_AMOUNT,
    quoteAsset,
    tokenUri: "",
    tokenParams: "0x",
    tokenSalt: ethers.ZeroHash,
  };
}

describe("FairLaunch startup", function () {
  async function deploySuite() {
    const [deployer, creator, trader] = await ethers.getSigners();
    const quote = await ethers.deployContract("MockERC20");
    const factory = await ethers.deployContract("CloneFactory");
    const core = await ethers.deployContract("MockFourCore", [await quote.getAddress()]);

    const tokenImpl = await ethers.deployContract("OpenFourToken");
    const tokenModule = await ethers.deployContract("StandardTokenModule");
    const vaultImpl = await ethers.deployContract("StandardVault");
    const curveImpl = await ethers.deployContract("FairLaunchCurveModule");
    const tradeImpl = await ethers.deployContract("FairLaunchTradeModule");
    const dataImpl = await ethers.deployContract("FairLaunchCustomDataModule");
    const migrateImpl = await ethers.deployContract("FairLaunchMigrateModule");
    const validator = await ethers.deployContract("FairLaunchPresetValidator", [{
      expectedPresetId: 0,
      requiredQuoteAsset: ethers.ZeroAddress,
      minSaleAmount: 0,
      maxSaleAmount: 0,
      maxRaiseAmount: 0,
    }]);

    async function cloneOf(impl) {
      const implAddr = await impl.getAddress();
      const addr = await factory.clone.staticCall(implAddr);
      await factory.clone(implAddr);
      return addr;
    }

    return {
      deployer,
      creator,
      trader,
      quote,
      factory,
      core,
      tokenImpl,
      tokenModule,
      vaultImpl,
      curveImpl,
      tradeImpl,
      dataImpl,
      migrateImpl,
      validator,
      cloneOf,
    };
  }

  it("compiles FairLaunch descriptors and schemas", async function () {
    const { curveImpl, tradeImpl, dataImpl, migrateImpl, tokenModule } = await deploySuite();
    expect((await tokenModule.descriptor()).tag).to.equal("module.token.standard");
    expect((await curveImpl.moduleEncodeSchema()).kind).to.equal("curve");
    expect((await tradeImpl.moduleEncodeSchema()).kind).to.equal("trade");
    expect((await dataImpl.moduleEncodeSchema()).kind).to.equal("customData");
    expect((await migrateImpl.moduleEncodeSchema()).kind).to.equal("migrate");
  });

  it("initializes a token clone through StandardTokenModule", async function () {
    const s = await deploySuite();
    const token = await ethers.getContractAt("OpenFourToken", await s.cloneOf(s.tokenImpl));
    const vault = ethers.Wallet.createRandom().address;
    const curve = ethers.Wallet.createRandom().address;
    const trade = ethers.Wallet.createRandom().address;
    const migrate = ethers.Wallet.createRandom().address;
    const data = ethers.Wallet.createRandom().address;
    const params = tokenCreateParams(await s.quote.getAddress());

    await s.tokenModule.createToken(
      s.creator.address,
      await token.getAddress(),
      vault,
      curve,
      trade,
      migrate,
      data,
      params,
      "1.0.0",
      "1.0.0",
    );

    expect(await token.name()).to.equal("Example Token");
    expect(await token.symbol()).to.equal("EXM");
    expect(await token.maxSupply()).to.equal(MAX_SUPPLY);
    expect(await token.vault()).to.equal(vault);
    expect(await token.balanceOf(vault)).to.equal(MAX_SUPPLY);
    await expect(
      s.tokenModule.createToken(
        s.creator.address,
        await token.getAddress(),
        vault,
        curve,
        trade,
        migrate,
        data,
        params,
        "1.0.0",
        "1.0.0",
      ),
    ).to.be.reverted;
  });

  it("prices buys on FairLaunchCurveModule", async function () {
    const s = await deploySuite();
    const curve = await ethers.getContractAt("FairLaunchCurveModule", await s.cloneOf(s.curveImpl));
    const token = ethers.Wallet.createRandom().address;
    await curve.init(token, await s.core.getAddress(), tokenCreateParams(await s.quote.getAddress()), encodeCurve(), "1.0.0");

    const buy = await curve.evaluate({
      token,
      trader: s.trader.address,
      amount: MIN_PURCHASE,
      isBuy: true,
      remainingForSale: SALE_AMOUNT,
      totalRaised: 0,
      timestamp: 1,
      proof: "0x",
    });
    expect(buy.executable).to.equal(true);
    expect(buy.quoteAmount).to.equal(FIXED_PRICE);

    const rejected = await curve.evaluate({
      token,
      trader: s.trader.address,
      amount: MIN_PURCHASE / 2n,
      isBuy: true,
      remainingForSale: SALE_AMOUNT,
      totalRaised: 0,
      timestamp: 1,
      proof: "0x",
    });
    expect(rejected.executable).to.equal(false);

    const [revAmount, revQuote] = await curve.evaluateReverse(
      token,
      true,
      FIXED_PRICE,
      SALE_AMOUNT,
      0,
      1,
    );
    expect(revAmount).to.equal(MIN_PURCHASE);
    expect(revQuote).to.equal(FIXED_PRICE);
  });

  it("initializes vault and records a core-only buy", async function () {
    const s = await deploySuite();
    const vault = await ethers.getContractAt("StandardVault", await s.cloneOf(s.vaultImpl));
    const token = await ethers.getContractAt("OpenFourToken", await s.cloneOf(s.tokenImpl));
    const migrate = ethers.Wallet.createRandom().address;
    const params = tokenCreateParams(await s.quote.getAddress());

    await s.tokenModule.createToken(
      s.creator.address,
      await token.getAddress(),
      await vault.getAddress(),
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      migrate,
      ethers.ZeroAddress,
      params,
      "1.0.0",
      "1.0.0",
    );

    await vault.init(
      await token.getAddress(),
      await s.core.getAddress(),
      s.creator.address,
      migrate,
      params,
      "0x",
      "1.0.0",
    );
    expect(await vault.remainingForSale()).to.equal(SALE_AMOUNT);

    await expect(
      vault.onBuy({
        trader: s.trader.address,
        tokenAmount: MIN_PURCHASE,
        curveQuote: FIXED_PRICE,
        protocolFee: 0,
        taxFee: 0,
        devFee: 0,
        antiSniperQuote: 0,
      }),
    ).to.be.revertedWith("Vault: only fourCore");
  });

  it("returns empty revertData when a trade is allowed and a custom error when blocked", async function () {
    const s = await deploySuite();
    const token = await ethers.getContractAt("OpenFourToken", await s.cloneOf(s.tokenImpl));
    const tokenAddr = await token.getAddress();
    const params = tokenCreateParams(await s.quote.getAddress());
    const vault = ethers.Wallet.createRandom().address;
    const curve = ethers.Wallet.createRandom().address;
    const migrate = ethers.Wallet.createRandom().address;

    await s.tokenModule.createToken(
      s.creator.address,
      tokenAddr,
      vault,
      curve,
      ethers.Wallet.createRandom().address,
      migrate,
      ethers.ZeroAddress,
      params,
      "1.0.0",
      "1.0.0",
    );

    const allowedTrade = await ethers.getContractAt("FairLaunchTradeModule", await s.cloneOf(s.tradeImpl));
    await allowedTrade.init(tokenAddr, await s.core.getAddress(), encodeTrade(0n), "1.0.0");
    const allowed = await allowedTrade.evaluate(tradeContext(tokenAddr, s.trader.address));
    expect(allowed.allowed).to.equal(true);
    expect(allowed.revertData).to.equal("0x");
    await expect(s.core.enforceTradeResult(asTradeResult(allowed))).to.not.be.reverted;

    const blockedTrade = await ethers.getContractAt("FairLaunchTradeModule", await s.cloneOf(s.tradeImpl));
    await blockedTrade.init(tokenAddr, await s.core.getAddress(), encodeTrade(MAX_PURCHASE), "1.0.0");
    const blocked = await blockedTrade.evaluate(tradeContext(tokenAddr, s.trader.address));
    const expected = blockedTrade.interface.encodeErrorResult("FairTradeMissingCustomData", [tokenAddr]);
    expect(blocked.allowed).to.equal(false);
    expect(blocked.revertData).to.equal(expected);
    await expect(s.core.enforceTradeResult(asTradeResult(blocked)))
      .to.be.revertedWithCustomError(blockedTrade, "FairTradeMissingCustomData")
      .withArgs(tokenAddr);
  });

  it("accepts a valid FairLaunch validator payload and rejects a raise mismatch", async function () {
    const { validator, quote } = await deploySuite();
    const ok = {
      name: "Example Token",
      symbol: "EXM",
      tokenUri: "",
      maxSupply: MAX_SUPPLY,
      saleAmount: SALE_AMOUNT,
      raiseAmount: RAISE_AMOUNT,
      quoteAsset: await quote.getAddress(),
      tokenSalt: ethers.ZeroHash,
      tokenParams: "0x",
      vaultParams: "0x",
      curveParams: encodeCurve(),
      tradeParams: encodeTrade(),
      migrateParams: encodeMigrate(),
      customDataParams: "0x",
    };
    await expect(validator.validate(1001, ok)).to.not.be.reverted;

    const bad = { ...ok, raiseAmount: RAISE_AMOUNT + 1n };
    await expect(validator.validate(1001, bad)).to.be.revertedWith("FairValidator: raiseAmount mismatch");
  });

  it("accepts the create-and-trade script encoding", async function () {
    const { encodeFairLaunchParams, MAX_SUPPLY: demoSupply, SALE_AMOUNT: demoSale, RAISE_AMOUNT: demoRaise } = require("../scripts/lib/demo");
    const { validator, quote } = await deploySuite();
    const encoded = encodeFairLaunchParams();
    await expect(validator.validate(1001, {
      name: "FairLaunch Demo",
      symbol: "FLDM",
      tokenUri: "",
      maxSupply: demoSupply,
      saleAmount: demoSale,
      raiseAmount: demoRaise,
      quoteAsset: await quote.getAddress(),
      tokenSalt: ethers.ZeroHash,
      ...encoded,
    })).to.not.be.reverted;
  });
});
