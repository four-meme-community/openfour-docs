# Environment

## Toolchain

- Node.js 18+
- Hardhat `^2.22` + `@nomicfoundation/hardhat-toolbox`
- **solc 0.8.24** (matches official OpenFour)
- OpenZeppelin `4.9.6` (`@openzeppelin/contracts` and `contracts-upgradeable`)
- ethers v6 (same as the Workbench)

`hardhat.config.js` must be:

```js
solidity: {
  version: "0.8.24",
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true
  }
}
```

Do not use Foundry as the primary compiler for implementation bytecode. Ignore third-party Foundry trees such as `contracts/stock4/sih`.

## Startup project

The official start point is `developer/startup/`: Hardhat + solc 0.8.24, with the full FairLaunch example, `OpenFourToken`, and required interfaces. There is **no** OpenFourCore implementation.

```bash
cd developer/startup
npm install
npx hardhat compile
npx hardhat test
```

Add new modules in this project. Do not start an incompatible compile environment. Other token references remain under repo-root `contracts/token/`.

After fork-deploy, the FairLaunch sample can be registered and exercised with:

```bash
cd developer
npm run setup
cd startup
PRESET=fairlaunch npx hardhat run scripts/register.js --network bsctestnet
PRESET=fairlaunch npx hardhat run scripts/create-and-trade.js --network bsctestnet
```

Use the same `DEPLOYER_PRIVATE_KEY` as fork-deploy. Point `FORK_JSON` at `developer/fork-deploy/out/fork-deployment.json` if it is not found automatically.

## Docs and Workbench

```bash
git clone https://github.com/four-meme-community/openfour-docs.git
# Read
#   docs/developer-guide.md
#   developer/startup
#   contracts/interfaces
#   contracts/token
```

The Workbench is a visual check, not a required UI:

```bash
cd developer/workbench
npm install
npm run dev
```

Local workspace:

| File | Purpose |
| --- | --- |
| `developer/workbench/data/fork.json` | Fork addresses, moduleIds, this run's registrations |
| `developer/workbench/data/tokens.json` | Created token list; do not scan the chain |
| `developer/workbench/data/skill-run.json` | Optional skill progress |

`data/*.json` is not committed.

## Fork testnet

`fork-deploy` does not compile OpenFour. It reads ERC-1967 implementations already on the deployed testnet, then deploys **new proxies**. The deployer becomes owner.

```bash
cd developer/fork-deploy
npm install
cp .env.example .env
# Set DEPLOYER_PRIVATE_KEY. RPC defaults to https://bsc-testnet.publicnode.com
# Do not put private RPC URLs or API keys into this repo.
# RPC must be the deployed BSC Testnet, or anvil/hardhat forked from it
# A blank chain has no implementation bytecode and cannot be forked
npm run fork:dry
npm run fork
```

Rules:

- Leave `SIGNER_ADDRESS` empty so it defaults to the deployer.
- `DRY_RUN=1` is read-only and does not broadcast.
- `chainId` 56 / 4663 is forbidden.
- After success, copy `out/fork-deployment.json` to `developer/workbench/data/fork.json`.
- Verify `addresses.registry`, `addresses.core`, `addresses.feeRouter`, standard + tax `moduleIds`, and both bundled presets: `presets.bondingV1` and `presets.bondingTaxV1`.
- With the deployer key, read `Registry.owner()`, `Core.signer()`, and `Core.wrappedNative()` and confirm they match expectations.

Default fork input is `developer/fork-deploy/source/bsctestnet.json`. Fork your own proxy set and register only on the Registry in your `fork.json`.

### Bundled example presets (no extra register)

After fork, create immediately in Workbench:

| Preset | Use |
| --- | --- |
| **Bonding V1** | Standard bonding create / trade smoke test |
| **Bonding Tax V1** | TaxToken + Royalty; develop/test unverified `ForwardVault` templates |

Royalty template flow: implement under `contracts/taxvault/` → deploy template → Create with Bonding Tax V1 → `taxVaultTypeId = keccak256("SafuSkill.ForwardVault.v1")` and `abi.encode(template, initData)` → buy to exercise the 6%/94% split. Step-by-step: [`developer/fork-deploy/README.md`](../../fork-deploy/README.md) and [Unverified Royalty](../../../docs/mechanisms/unverified-royalty.md).

## Funds and network

- Deploy / create / trade need test BNB (or impersonation / prefunded balances on a local fork).
- When quote is WBNB, attach `msg.value` for `createToken` / `buy` using the Workbench native rules.
- On a local anvil fork, RPC, `fork.json.rpcUrl`, and the wallet chainId must match.
