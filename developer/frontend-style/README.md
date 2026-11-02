# OpenFour frontend style (temporary preset UI)

When a new Preset needs **extra frontend pages** beyond the standard create / trade flow (custom dashboards, special create steps, post-trade actions, etc.), production UI on the official website is built by OpenFour. Developers provide a temporary page as a **design and interaction reference** for audit — not a production host, and not a drop-in merge into the official site.

## Policy

1. Build a **temporary** page for fork demos and audit review.
2. Follow the official website look using this directory (`tokens.css` / `base.css`). Do not invent a separate visual brand.
3. Submit the temporary UI **together with the contract audit pack** (source, screenshots, and/or a demo link).
4. After approval, OpenFour **ports** the needed flows into the official website, using your temporary page as reference. Officials rewrite and integrate it themselves; they do **not** ship your original temporary page as-is on the official site.

## Files

| File | Use |
| --- | --- |
| `tokens.css` | Brand colors, surfaces, radii, focus/glow variables aligned with the official website |
| `base.css` | Page / panel / input / button primitives (`of-*` classes) |
| `README.md` | This policy |

## Quick use

```html
<link rel="stylesheet" href="./base.css" />
<main class="of-page">
  <div class="of-main">
    <h1 class="of-title">My Preset demo</h1>
    <p class="of-lede">Temporary UI for audit. Reference only — not production.</p>
    <section class="of-panel of-panel-brand">
      <label class="of-label">Amount
        <input class="of-input" placeholder="0.0" />
      </label>
      <button class="of-btn of-btn-primary" type="button">Continue</button>
    </section>
  </div>
</main>
```

Keep the temporary app small: only the screens the Preset actually needs.
