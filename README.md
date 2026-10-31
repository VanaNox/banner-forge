# Banner Forge

Browser-only HTML5 banner converter for ad operations teams.

It accepts a prepared DV360 HTML5 zip and generates platform-specific packages for UMH,
Fusify / AdPartner and Admixer.

The app runs locally in the browser. Uploaded creatives are not sent to a backend.

## Delivery matrix

The format of the uploaded creative is detected from its size (`meta ad.size`, then the
container CSS, then a `WxH` in the file name) and locked in, so a correctly sized DV360
source needs no further input. Only the platforms that order that format stay selectable;
the lock can be opened to pick a format by hand.

| Format | Native DV360 source | Platforms |
| --- | --- | --- |
| 300x250, 300x600, 320x100, 336x280, 728x90 | own size | Fusify / AdPartner |
| Fullscreen | 492x696 or 696x492 | Admixer, UMH |
| Halfscreen | 800x400 (UMH also 1600x800) | Fusify / AdPartner, Admixer, UMH |
| Catfish | 1920x200 (UMH also 3840x400) | Admixer, UMH |

`1600x800` and `3840x400` are the accepted 2x variants of their base size. The matrix lives
in `src/lib/formatMatrix.ts` and is pinned by `tests/formatMatrix.test.ts`.

Creatives for 1+1, DV360, VPoint, Division Global Digital and RST are out of scope: those
platforms take the DV360 package itself, so there is nothing to convert.

Off-matrix combinations still convert but are reported as warnings.

### Two layouts in one package

Like the freelancer reference banners (ZYN, November 2026), a fluid package can carry a
second DV360 resize of the same creative and show whichever fits the slot. Add it under
**Second layout** (or pass it as the third argument of `convertDv360Banner`):

| Format | Platforms that pack it | Switch |
| --- | --- | --- |
| Fullscreen (e.g. 492x696 + 800x400) | UMH, Admixer | landscape layout once the slot is at least as wide as tall |
| Halfscreen (e.g. 800x400 + 1920x200) | Admixer | wide layout from a 3:1 slot |

Other platforms ignore the second layout. Without it, a package is built from the one
source as before.

UMH and Admixer fluid packages put the creative on a small stage. The stage scales the
layout to fit the slot, centres it and fills the rest with the creative's background
colour. Catfish stays at native size, centred. AdPartner halfscreen keeps its own
`for_halfscreen_style.css` scaling.

## Development

```bash
npm install
npm run dev
```

## Validation

```bash
npm run test
npm run build
```

## Deployment

The repository includes a GitHub Pages workflow in `.github/workflows/pages.yml`.
Pushing to `main` builds the Vite app and deploys `dist` to GitHub Pages.
