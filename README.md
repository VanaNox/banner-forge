# Banner Forge

Browser-only HTML5 banner converter for ad operations teams.

It accepts a prepared DV360 HTML5 zip and generates platform-specific packages for:

- UMH
- Fusify / AdPartner
- Admixer

The app runs locally in the browser. Uploaded creatives are not sent to a backend.

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
