const hre = require("hardhat");

const MODULES = [
  ["OpenFourToken", "token.standard"],
  ["StandardTokenModule", "module.token.standard"],
  ["StandardVault", "module.vault.standard"],
  ["FairLaunchCurveModule", "module.curve.fair_launch"],
  ["FairLaunchTradeModule", "module.trade.fair_launch"],
  ["FairLaunchCustomDataModule", "module.data.fair_launch"],
  ["FairLaunchMigrateModule", "module.migrate.fair_launch"],
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const out = {
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    implementations: {},
    moduleKeys: {},
  };

  for (const [name, keySource] of MODULES) {
    const deployed = await hre.ethers.deployContract(name);
    await deployed.waitForDeployment();
    out.implementations[name] = await deployed.getAddress();
    out.moduleKeys[name] = {
      keySource,
      moduleKey: hre.ethers.keccak256(hre.ethers.toUtf8Bytes(keySource)),
    };
  }

  const validator = await hre.ethers.deployContract("FairLaunchPresetValidator", [{
    expectedPresetId: 0,
    requiredQuoteAsset: hre.ethers.ZeroAddress,
    minSaleAmount: 0,
    maxSaleAmount: 0,
    maxRaiseAmount: 0,
  }]);
  await validator.waitForDeployment();
  out.implementations.FairLaunchPresetValidator = await validator.getAddress();

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
