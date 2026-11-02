# OpenFour Fork Deploy

Creates a developer-owned OpenFour proxy set from the **shared developer hub** on BSC Testnet. It does not compile or contain the OpenFour Core, Registry, FeeRouter, Deployer, or Tools implementation source.

It registers only these standard modules:

- `TOKEN_STANDARD`
- `VAULT_BASIC`
- `CURVE_BONDING`
- `TRADE_SIMPLE`
- `MIGRATE_BONDING`

## Source

`source/bsctestnet.json` is the default hub address list. `npm run fork` reads it, reuses on-chain implementations, and deploys a new proxy set you own.

Fork your own set before registering modules. Do not upsert the shared hub Registry unless you are its owner.

## Requirements

- Node.js 18+
- A BSC Testnet RPC, or a local Anvil/Hardhat fork of BSC Testnet
- Test BNB when broadcasting to BSC Testnet

## Usage

```bash
cd developer/fork-deploy
npm install
cp .env.example .env
# Set DEPLOYER_PRIVATE_KEY. RPC defaults to https://bsc-testnet.publicnode.com
npm run fork:dry
npm run fork
```

`fork:dry` reads the current on-chain implementations and configuration without sending transactions. `fork` deploys a new proxy set owned by `DEPLOYER_PRIVATE_KEY` and writes its public addresses to `out/fork-deployment.json`.

Copy that file to `developer/workbench/data/fork.json` for the Workbench / startup scripts.

Never commit `.env`, private keys, or files under `out/`.

After a hub redeploy, maintainers can refresh the default source with:

```bash
npm run promote-source
```

## Scope

The bundled source JSON contains only public proxy addresses, five module identifiers, and the Bonding V1 preset identifier. Implementations and module metadata are read from chain at runtime.
