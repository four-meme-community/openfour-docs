---
name: openfour-developer
description: Guides the OpenFour development workflow on a developer-owned fork. Covers Hardhat/solc 0.8.24 setup, preset modules, Fork Registry registration, createToken/buy/sell/migrate verification, AI security audit, and official submission. Use when building OpenFour modules, presets, token implementations, fork-deploy, workbench, or when the user mentions module development, prepare testnet, upsertModule, createToken, or official audit.
---

# OpenFour Development Workflow

Guide the agent through a full preset: environment → develop → fork registration → create/trade/migrate → end-to-end verification → AI security audit → official submit pack. Do not skip steps. Do not stop after writing contracts.

The human UI is `developer/workbench/`. This skill requires scripts and on-chain calls. Use the Workbench only to double-check.

## Hard rules

- Write only to a **developer-owned Fork Registry** (the one in your `fork.json`). Never call `upsertModule` / `upsertPreset` / `upsertTokenImpl` on someone else's Registry.
- Stop all writes when `chainId` is `56` or `4663`.
- Do not compile, decompile, or copy OpenFour Core / Registry / FeeRouter / CreateDeployer implementations.
- Match the official compile env: Hardhat + **solc 0.8.24**, optimizer enabled, `runs: 200`, `viaIR: true`. Start from `developer/startup`.
- Custom tokens must inherit `OpenFourToken` and call `__OpenFourToken_init`. Do not rewrite a blank ERC20.
- Replace only the slots that actually change. Reuse Standard / already-registered modules for the rest.
- After fork-deploy, `Core.signer` must be the deployer (or an address the deployer controls).
- Security review is defensive findings and fixes only. Do not write exploits, PoCs, or attack scripts.
- Do not commit private keys, `.env`, `fork-deploy/out/`, or `workbench/data/*.json`.

## Progress

Copy and keep this list. Do not enter the next phase until the current box is checked. State may be written to `developer/workbench/data/skill-run.json` (not committed).

```
- [ ] 0 Locate the repo and write the preset brief
- [ ] 1 Environment: startup / Hardhat 0.8.24 + fork-deploy
- [ ] 2 Develop: modules / token / validator / unit tests compile and pass
- [ ] 3 Register: upsert on the Fork Registry only
- [ ] 4 Lifecycle: createToken → buy/sell → migrate
- [ ] 5 Verify: on-chain state matches expected invariants
- [ ] 6 AI security audit: no Critical / High, or fixed and re-reviewed
- [ ] 7 Submit pack: Fork Registry + (if needed) temporary UI styled with frontend-style
```

## Phase 0 — Scope

1. Confirm the repo root is `openfour-docs` (contains `contracts/`, `docs/developer-guide.md`, `developer/`). If not, clone `https://github.com/four-meme-community/openfour-docs.git`.
2. Ask the user for a one- or two-sentence preset: pricing, buy/sell limits, graduation, whether the token body changes, external-market behavior.
3. Pick slots by responsibility. Do not rewrite all five:

| Change | Write | Reuse |
| --- | --- | --- |
| Pricing only | Curve | Token / Vault / Trade / Migrate |
| Trade rules or fees only | Trade; add CustomData if cumulative / cooldown / whitelist is needed | The rest |
| Graduation / external target only | Migrate | The rest |
| Custody or accounting | Vault (high risk) | Prefer not to change |
| ERC20 / external-market tax | Inherit `OpenFourToken` + matching Token module | Internal market still uses Curve / Trade |

4. Choose the `tag` / `moduleKey` source string, e.g. `module.curve.my_play`. `moduleKey = keccak256(utf8)`, `tagId = bytes8(moduleKey)`.
5. Read [environment.md](environment.md) first, then the phase file. Details follow `docs/developer-guide.md`.

## Phase 1 — Environment

Follow [environment.md](environment.md). Done when:

- `npx hardhat compile` succeeds with solc 0.8.24.
- `developer/fork-deploy/out/fork-deployment.json` exists.
- Deployer == Fork Registry owner == `Core.signer()` (unless the user set another signer they control).
- `developer/workbench/data/fork.json` is written (copy of fork-deployment or an equivalent structure).
- The current `registry` matches `fork.json`, and `chainId` is not 56 / 4663.

## Phase 2 — Develop

Follow [develop.md](develop.md). Done when:

- Each new module has one-time `init`, binds `fourCore` / `token`, `descriptor()`, `getInitParams()`, `moduleEncodeSchema()` matching `Params` order, the core interface functions, and Hardhat tests.
- Cross-module invariants live in the validator, not scattered across modules.
- Custom tokens inherit `OpenFourToken` and do not drop parent `InitArgs` fields.
- `npx hardhat compile` and the relevant `npx hardhat test` pass.

## Phase 3 — Register

Follow [register.md](register.md) and register only on the fork. Done when:

- The new implementation is deployed on the current fork network.
- `upsertModule` (and `upsertTokenImpl` if needed) succeeded.
- `upsertPreset` has all five slots; unchanged slots reuse Standard / Bonding ids from the fork.
- `active = true` and `createEnabled = true`.
- Results are written to `out/<id>-registration.json` and `fork.json` as `developerModules` / `developerPresets`.
- New preset is a copied `presets/<id>.json`, not a copied register script.

## Phase 4 — Create and trade

Follow [lifecycle.md](lifecycle.md).

For the **three built-in presets** after fork: run the **smoke reference** `PRESET=bondingV1|bondingTaxV1|stock4TaxV1|all npm run create-test-preset` (optional `SELL=1`, `FORWARD_VAULT=1` + template). Not a product client. [fork-deploy README](../../fork-deploy/README.md#create--buy--sell--migrate-built-in-presets).

Done when:

- `createToken` static precheck and broadcast succeed, and the token address is parsed.
- The record is written to `developer/workbench/data/tokens.json`.
- `estimateBuy` / `buy` or `buyByBudget` succeeds, and vault accounting matches expectations.
- If the preset allows sells: `estimateSell` / `sell` succeeds (or `SELL=1` on create-test-preset).
- Vault reaches Migrated via sell-out buy (auto) or an explicit `migrate`, or the run notes why this preset does not migrate.

## Phase 5 — Verify

Use the [lifecycle.md](lifecycle.md) checklist and write a verification record (may attach to `skill-run.json`):

- Module addresses in Core `tokens(token)` match the Preset.
- Vault `remainingForSale` / `totalRaised` / `phase` match buy, sell, and migrate.
- `descriptor()` tag, schema encoding, and create params round-trip.
- Failure paths (expired signature, non-signer, bad schema, migrate before graduation) revert or return `allowed=false` as expected.

If verification fails, return to Phase 2. Do not submit.

## Phase 6 — AI security audit

Follow [audit.md](audit.md) for **this change set** of modules, token, and validator. Do not audit or request unpublished Core source.

Done when:

- A structured audit report exists (scope, invariants, findings, verdict).
- Critical / High issues are fixed and re-reviewed. Medium issues are fixed or explicitly accepted.
- A failing verdict blocks Phase 7.

## Phase 7 — Official submit pack

Prepare the submit pack. **Do not** write production Registries yourself. Include at least:

- Module / Preset / token source and commit
- Gameplay description, composition, and risk notes
- `descriptor()` tag, version, schema, and moduleKey source string
- Validator rules and tests
- Create / buy / sell / migrate records from this workflow (`tokens.json` summary)
- **Fork development Registry address**
- Phase 6 audit report
- **If the Preset needs extra frontend pages:** temporary UI built with `developer/frontend-style/` (official website look), plus screenshots or a demo link (see [frontend.md](frontend.md))

Entry: `https://four.meme`. Process: Developer Guide §17–§20.

Temporary extra UI is reference material for audit. OpenFour ports approved flows into the official website; your original temporary page is not shipped as-is.

## Additional resources

- [environment.md](environment.md) — compile env, startup, fork-deploy, workspace JSON
- [develop.md](develop.md) — slots, interfaces, schema, tokens
- [register.md](register.md) — deploy and upsert
- [lifecycle.md](lifecycle.md) — signed create, trade, migrate, verification
- [audit.md](audit.md) — AI security audit and submit gate
- [frontend.md](frontend.md) — temporary preset UI + official style pack
- `docs/developer-guide.md`
- `contracts/interfaces/`, `contracts/token/`, `developer/startup/`, `developer/frontend-style/`
