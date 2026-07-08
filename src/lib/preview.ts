import JSZip from 'jszip';
import type { OutputPackage } from './types';

const PREVIEW_STUB = `<script>
window.globalHTML5Api = window.globalHTML5Api || {
  on: function (_event, callback) { if (typeof callback === 'function') setTimeout(callback, 0); },
  init: function () {},
  click: function () { console.info('[Preview] Admixer click'); },
  close: function () { console.info('[Preview] Admixer close'); },
  src: function (path) { return path; }
};
window.adPartner = window.adPartner || {
  click: function () { console.info('[Preview] AdPartner click'); return false; }
};
window.admixAPI = window.admixAPI || {
  click: function () { console.info('[Preview] UMH click'); return false; }
};
</script>`;

export async function createPackagePreviewUrl(output: OutputPackage): Promise<string> {
  if (output.platform === 'bundle') {
    throw new Error('Bundle preview is not available. Select a platform package.');
  }

  const zip = await JSZip.loadAsync(output.blob);
  const entryName = output.platform === 'admixer' ? 'body.html' : 'index.html';
  const entry = zip.file(entryName);
  if (!entry) {
    throw new Error(`${entryName} was not found in ${output.fileName}.`);
  }

  const assetUrls = new Map<string, string>();
  const files = Object.values(zip.files).filter((file) => !file.dir && file.name !== entryName);

  await Promise.all(files.map(async (file) => {
    const bytes = await file.async('blob');
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeForPath(file.name) }));
    assetUrls.set(normalizePath(file.name), url);
    assetUrls.set(basename(file.name), url);
  }));

  const sourceHtml = await entry.async('text');
  const rewritten = injectPreviewStub(rewriteReferences(sourceHtml, assetUrls));
  return URL.createObjectURL(new Blob([rewritten], { type: 'text/html' }));
}

function rewriteReferences(html: string, assetUrls: Map<string, string>): string {
  return html
    .replace(/((?:src|href)=["'])([^"']+)(["'])/gi, (_match, prefix: string, url: string, suffix: string) => {
      return `${prefix}${resolveAssetUrl(url, assetUrls)}${suffix}`;
    })
    .replace(/url\((['"]?)([^'")]+)\1\)/gi, (_match, quote: string, url: string) => {
      return `url(${quote}${resolveAssetUrl(url, assetUrls)}${quote})`;
    });
}

function resolveAssetUrl(url: string, assetUrls: Map<string, string>): string {
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('#') || url.startsWith('blob:')) {
    return url;
  }
  const normalized = normalizePath(url);
  return assetUrls.get(normalized) || assetUrls.get(basename(normalized)) || url;
}

function injectPreviewStub(html: string): string {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (head) => `${head}\n${PREVIEW_STUB}`);
  }
  return `${PREVIEW_STUB}\n${html}`;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.js')) return 'text/javascript';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.xml')) return 'application/xml';
  return 'application/octet-stream';
}
