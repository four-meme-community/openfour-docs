# Temporary preset frontend

If the new Preset needs **extra UI** on top of the standard create / buy / sell / migrate screens (custom create steps, dashboards, claims, special actions), production UI on the official website is implemented by OpenFour. Developers build a temporary page as a **reference** for fork testing and audit.

## Rules

- Style the temporary page with `developer/frontend-style/` (`tokens.css` + `base.css`). Follow the official website look; do not invent a new brand.
- The temporary page is for demos and review only. It is **not** hosted as production UI, and it is **not** merged as-is into the official site.
- After approval, OpenFour **ports** the needed flows into the official website, using your temporary page as reference.
- Submit the temporary frontend **with** the Phase 7 audit pack (source or zip, short UX notes, screenshots or demo URL).
- Prefer schema-driven standard create forms when possible. Extra pages are only for flows the shared create UI cannot express.

## Agent checklist

- [ ] Decide whether this Preset needs extra frontend pages
- [ ] If yes: scaffold a minimal temporary page using `developer/frontend-style/base.css`
- [ ] Demo the page against the developer-owned Fork Registry
- [ ] Attach UI source + notes + screenshots/demo to the submit pack
- [ ] Treat the temporary page as reference material, not a production deliverable to be shipped unchanged

## References

- Style pack: `developer/frontend-style/README.md`
- Submit pack: Phase 7 in `SKILL.md`, `scripts/pack-submit.js`
- Product rules: Developer Guide §§17–20
