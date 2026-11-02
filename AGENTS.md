# openfour-docs

Public OpenFour documentation, sample contracts, and the community developer toolkit. This repo does **not** contain OpenFourCore, Registry, FeeRouter, or CreateDeployer implementation source.

## Read first

- Module / Preset / token rules: [docs/developer-guide.md](docs/developer-guide.md) ([繁體中文](docs/zh-Hant/developer-guide.md))
- FairLaunch starter: [developer/startup/README.md](developer/startup/README.md)
- Integrators (wallets, indexers): [docs/integration-guide.md](docs/integration-guide.md)
- Development workflow skill: [developer/skills/openfour-developer/SKILL.md](developer/skills/openfour-developer/SKILL.md)

When the task is building or testing a preset module, follow the skill. Do not skip from writing Solidity to “done”.

## Layout

| Path | Use |
| --- | --- |
| `docs/` | Official guides. Canonical spec stays here; do not move it into `developer/`. |
| `contracts/` | Public interfaces and token references. |
| `scripts/` | ABI helpers and create-arg codecs. |
| `developer/startup/` | FairLaunch Hardhat starter. New preset = copy `presets/fairlaunch.json`. |
| `developer/fork-deploy/` | New ERC-1967 proxies over already-deployed testnet implementations. |
| `developer/workbench/` | Local 7-step UI. Token list is `workbench/data/tokens.json`, not chain logs. |
| `developer/frontend-style/` | Official-website style tokens for temporary Preset UI (audit reference; OpenFour ports to the site). |
| `developer/skills/` | Agent-executable version of the same development workflow. |

## Hard rules

- Write only to a **developer-owned Fork Registry** (the one in your `fork.json`). Never `upsertModule` / `upsertPreset` / `upsertTokenImpl` on a Registry you do not own.
- Stop all chain writes when `chainId` is `56` or `4663`.
- Do not compile, decompile, or copy Core / Registry / FeeRouter / CreateDeployer implementations. Use `contracts/interfaces/` only.
- Compile env: Hardhat + **solc 0.8.24**, optimizer on, `runs: 200`, `viaIR: true`. Do not change these in `developer/startup`.
- Custom tokens inherit `OpenFourToken` and call `__OpenFourToken_init`. Do not start from a blank ERC20.
- Replace only the slots that change. Reuse Standard / already-registered modules for the rest.
- Trade ordinary rejection is `allowed=false` plus `revertData` encoded as `error Xxx(...)` via `abi.encodeWithSelector`. Do not revert from `evaluate`.
- After fork-deploy, `Core.signer` is the deployer (or an address the deployer controls).
- Security review: findings and fixes only. No exploits, PoCs, or attack steps.
- Do not commit `.env`, private keys, `developer/fork-deploy/out/`, or `developer/workbench/data/*.json`.

## Docs vs toolkit

`docs/` is the published spec. `developer/` is the sandbox. Keep new human docs in `docs/` (and `docs/zh-Hant/` when translating). Keep new tooling and FairLaunch example modules under `developer/`. Link between them; do not duplicate the full Developer Guide.

New module work starts in `developer/startup`. Do not copy FairLaunch modules back into repo-root `contracts/`.
