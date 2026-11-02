# OpenFour Developer Workbench

Local workbench for contract developers. The home page follows seven steps: docs → prepare a testnet → write modules → register on your own Registry → create a token → buy/sell/migrate → submit for official audit.

Fork results are written to `data/fork.json`. Created tokens are written to `data/tokens.json`. The token list reads that JSON only and does not scan the chain.

This is not the official frontend. `createToken` is signed locally by the current wallet, which must be `Core.signer` (the fork-deploy deployer by default).

## Usage

```bash
cd developer/fork-deploy
npm install
cp .env.example .env
npm run fork

cd ../workbench
npm install
npm run dev
```

After opening the local site:

1. Follow the home-page flow into **Prepare** and import `fork-deploy/out/fork-deployment.json` (copied to `data/fork.json`).
2. Connect the deployer / signer wallet.
3. Create a token with the current Preset. Success writes `data/tokens.json` and opens the detail page for buy, sell, and migrate.

`data/*.json` stays on this machine and is not committed.

## Scope

- Seven-step flow and navigation
- Local JSON workspace: `fork.json` / `tokens.json`
- Schema-driven create form from `OpenFourTools`
- Buy by amount, buy by budget, sell, migrate
- create calldata / signature digest debug snapshot
- Testnet and local forks

Does not include Tax / Stock4 / Uni / Zap special cases, official mainnet addresses, or production co-signing.
