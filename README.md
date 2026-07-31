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
| Catfish | 1920x200 or 3840x400 | UMH |

`1600x800` and `3840x400` are the accepted 2x variants of their base size. The matrix lives
in `src/lib/formatMatrix.ts` and is pinned by `tests/formatMatrix.test.ts`.

Creatives for 1+1, DV360, VPoint, Division Global Digital and RST are out of scope: those
platforms take the DV360 package itself, so there is nothing to convert.

Fluid placements do not auto-scale — a Bannerify creative is fixed in pixels, so the source
must already be at the format's native size. Off-matrix combinations still convert but are
reported as warnings.

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
