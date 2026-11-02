# AI security audit

Run a defensive audit of **modules, token implementations, and validators added or changed in this run**. Do not audit unpublished Core. Do not write exploits, PoCs, or attack steps. Findings describe condition, impact, and fix only.

If a Solidity audit skill is available, use it on this change set. Still complete the OpenFour checklist on this page and emit the report format below.

## Scope

- Include: this run's `.sol` files, matching tests, schema, and Preset composition.
- Exclude: `interfaces/`, `node_modules/`, unchanged Standard example modules, official Core.
- List invariants first, then check the code against them. Do not stop at generic ERC20 review.

## OpenFour checklist

General:

- [ ] `init` runs once; `fourCore` / `token` are non-zero
- [ ] `context.token` equals the bound token
- [ ] State writes are Core-only (or the documented module, e.g. Vault migrate transfers)
- [ ] Raw init params and Registry-injected version are stored
- [ ] `descriptor()` is stable; schema matches `Params` order
- [ ] No arbitrary `selfdestruct`, front-runnable init, or unauthorized upgrade

Curve:

- [ ] Quotes do not overflow; zero-amount behavior is explicit
- [ ] Supply bounds are explicit; forward and reverse quotes are consistent
- [ ] No trader history reads/writes; do not use `msg.sender` as trader

Trade:

- [ ] Ordinary rejection is `allowed=false`, not a business revert
- [ ] Fee bps has a cap; recipient is non-zero
- [ ] View-only; does not write state

CustomData:

- [ ] Hooks are onlyCore and check token
- [ ] Record post-execution facts; do not pre-approve
- [ ] Getters used by other modules are stable

Migrate:

- [ ] `evaluate` does not write state
- [ ] `execute` re-checks and does not trust `hookData`
- [ ] Quote/token usage is capped; external call return values are checked
- [ ] `migratedDataVersion` is explicit

Vault:

- [ ] SafeERC20; permissions and phase transitions are clear
- [ ] Custody and accounting cannot be bypassed

Token:

- [ ] Inherits `OpenFourToken`; standard getters remain
- [ ] Base ERC20 is intact; post-migrate transfer / pool permissions are clear

Composition:

- [ ] Validator covers cross-module invariants
- [ ] `customDataId=0` when unused; Preset binds CustomData when required
- [ ] No production-network write logic and no hardcoded external signer

## Severity

| Level | Meaning | Gate |
| --- | --- | --- |
| Critical | Direct fund loss, unbounded mint, or emptied custody | Must fix; block submit |
| High | Bypass of trade/graduation limits, or broken books | Must fix; block submit |
| Medium | Abuse or denial of service under realistic presets | Fix or accept in writing |
| Low / Info | Style, gas, maintainability | Record only |

## Report format

```markdown
# OpenFour module audit

- Date:
- Scope: (file list)
- Fork Registry:
- Preset id / moduleKeys:

## Invariants
- …

## Findings
### [C/H/M/L] Title
- Location:
- Condition: (trigger condition; no reusable attack script)
- Impact:
- Fix:

## Residual risk
- …

## Verdict
- Pass / Fail
- Ready for official submit: yes / no
```

## Next steps

1. Produce the report.
2. Send Critical / High back to Develop, then re-run compile, tests, and Phases 4–5 before re-review.
3. Re-review confirms the fix and regressions only. Do not expand into another preset.
4. Stop Phase 7 when Verdict is Fail.
5. Attach this report and the Fork Registry address to the submit pack. Officials still perform official registration.
6. If the Preset needs extra frontend pages, attach the temporary UI (styled with `developer/frontend-style/`, following the official website look) and screenshots or a demo. OpenFour uses it as reference and ports approved flows into the official site — see [frontend.md](frontend.md).
