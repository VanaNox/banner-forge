import JSZip from 'jszip';
import type { AdmixerMode, ConversionOptions, ConversionResult, CreativeMetadata, OutputPackage, TargetPlatform, ValidationCheck } from './types';

const DEFAULT_OPTIONS: ConversionOptions = {
  landingUrl: 'https://www.google.com',
  admixerMode: 'fullscreen',
  umhAutoButton: true,
  includePreviewIndex: true,
  targetPlatforms: ['umh', 'fusify', 'admixer']
};

type TextMap = Map<string, string>;

interface SourceCreative {
  zip: JSZip;
  metadata: CreativeMetadata;
  entryHtml: string;
  rootFiles: string[];
}

export async function convertDv360Banner(file: File | Blob, options?: Partial<ConversionOptions>): Promise<ConversionResult> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const source = await readSourceCreative(file);
  const targetPlatforms = mergedOptions.targetPlatforms.length > 0 ? mergedOptions.targetPlatforms : DEFAULT_OPTIONS.targetPlatforms;

  const outputs = await Promise.all(
    targetPlatforms.map((platform) => buildPlatformPackage(source, platform, mergedOptions))
  );

  const bundle = await buildBundle(outputs, source.metadata.sourceFileName);
  const warnings = [...new Set(outputs.flatMap((output) => output.warnings))];

  return {
    metadata: source.metadata,
    packages: [...outputs, bundle],
    warnings
  };
}

export async function readSourceCreative(file: File | Blob): Promise<SourceCreative> {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !isSystemFile(entry.name));
  const htmlEntries = entries.filter((entry) => /\.html?$/i.test(entry.name));

  if (htmlEntries.length === 0) {
    throw new Error('No HTML entrypoint found in the uploaded zip.');
  }

  const htmlByPath: TextMap = new Map();
  await Promise.all(
    htmlEntries.map(async (entry) => {
      htmlByPath.set(normalizePath(entry.name), await entry.async('text'));
    })
  );

  const entryPath = findCreativeEntry(htmlByPath);
  const entryHtml = htmlByPath.get(entryPath);
  if (!entryHtml) {
    throw new Error('Could not resolve the banner HTML entrypoint.');
  }

  const basePath = dirname(entryPath);
  const rootFiles = entries
    .map((entry) => normalizePath(entry.name))
    .filter((path) => basePath === '' || path === entryPath || path.startsWith(`${basePath}/`));

  const metadata: CreativeMetadata = {
    entryPath,
    basePath,
    sourceFileName: getSourceFileName(file),
    ...extractAdSize(entryHtml),
    title: extractTitle(entryHtml),
    assetCount: rootFiles.length,
    sourceSizeBytes: file.size,
    detectedClickTag: /clicktag/i.test(entryHtml)
  };

  return { zip, metadata, entryHtml, rootFiles };
}

async function buildPlatformPackage(source: SourceCreative, platform: TargetPlatform, options: ConversionOptions): Promise<OutputPackage> {
  const out = new JSZip();
  const warnings: string[] = [];
  const entryName = platform === 'admixer' ? 'body.html' : 'index.html';
  const mode = platform === 'admixer' ? options.admixerMode : undefined;
  const transformedHtml = transformHtml(source.entryHtml, platform, options);
  const validation: ValidationCheck[] = [
    { label: `${entryName} entrypoint`, passed: true },
    { label: 'System files removed', passed: !source.rootFiles.some(isSystemFile) },
    { label: 'Platform click hook', passed: hasPlatformClickHook(transformedHtml, platform) },
    { label: 'Conversion manifest', passed: true }
  ];

  for (const sourcePath of source.rootFiles) {
    const relativePath = stripBase(sourcePath, source.metadata.basePath);
    if (!relativePath || isSystemFile(relativePath) || /\.html?$/i.test(relativePath)) {
      continue;
    }
    const entry = source.zip.file(sourcePath);
    if (entry) {
      out.file(rewriteAssetPath(relativePath, platform), await entry.async('arraybuffer'));
    }
  }

  out.file(entryName, transformedHtml);
  out.file('conversion-manifest.json', JSON.stringify(buildManifest(source.metadata, platform, options), null, 2));
  if (options.includePreviewIndex) {
    out.file('preview.html', buildPreviewIndex(entryName, labelPlatform(platform)));
  }

  if (platform === 'admixer') {
    out.file('js/body.js', buildAdmixerBodyJs(mode ?? 'fullscreen'));
    validation.push({ label: 'Admixer API bridge', passed: true });
  }

  const sizeLimit = platform === 'admixer' ? 300_000 : 1_000_000;
  const blob = await out.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  if (blob.size > sizeLimit) {
    warnings.push(`${labelPlatform(platform)} package is ${(blob.size / 1024).toFixed(1)} KB; verify the platform weight limit before trafficking.`);
  }

  return {
    platform,
    fileName: buildOutputFileName(source.metadata.sourceFileName, platform),
    blob,
    sizeBytes: blob.size,
    warnings,
    validation
  };
}

async function buildBundle(outputs: OutputPackage[], sourceFileName: string): Promise<OutputPackage> {
  const bundle = new JSZip();
  outputs.forEach((output) => bundle.file(output.fileName, output.blob));
  const blob = await bundle.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return {
    platform: 'bundle',
    fileName: `${sourceBaseName(sourceFileName)}_converted_bundle.zip`,
    blob,
    sizeBytes: blob.size,
    warnings: [],
    validation: [{ label: 'Contains all platform packages', passed: true }]
  };
}

export function transformHtml(html: string, platform: TargetPlatform, options: ConversionOptions): string {
  const landingUrl = escapeForScript(options.landingUrl || DEFAULT_OPTIONS.landingUrl);
  const normalized = platform === 'fusify'
    ? flattenAssetReferences(removeDv360PreviewScripts(html))
    : removeDv360PreviewScripts(html);
  const withClickTag = upsertClickTag(normalized, landingUrl);

  if (platform === 'umh') {
    return addHeadMeta(withClickHandler(withClickTag, 'window.admixAPI && admixAPI.click ? admixAPI.click() : window.open(window.clickTag, "_blank")'), [
      ['ad.type', 'banner'],
      ['ad.size', adSizeContent(html)],
      ['ad.vars', `auto_button=${options.umhAutoButton ? '1' : '0'}`]
    ]);
  }

  if (platform === 'fusify') {
    return addHeadMeta(wrapBodyWithFusifyClick(withClickTag), [
      ['ad.size', adSizeContent(html)]
    ]);
  }

  return buildAdmixerHtml(withClickTag, options.admixerMode);
}

function buildAdmixerHtml(html: string, mode: AdmixerMode): string {
  const bodyInner = extractBodyInner(html);
  const headInner = extractHeadInner(html);
  const size = mode === 'fullscreen' ? 'width=device-width, initial-scale=1.0' : 'width=device-width, initial-scale=1.0, maximum-scale=1.0';
  const closeClass = mode === 'fullscreen' ? 'admix-close-button' : 'ad-close-button';
  const closeStyle = mode === 'fullscreen'
    ? 'position:absolute;width:24px;height:24px;right:0;top:0;z-index:9999;cursor:pointer;'
    : 'position:absolute;width:24px;height:24px;right:0;top:0;z-index:9999;cursor:pointer;';

  return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="${size}">
${headInner}
</head>
<body style="margin:0;overflow:hidden;">
<div id="admixer-click-area" style="position:relative;width:100%;height:100%;">
${bodyInner}
</div>
<button class="${closeClass}" id="close" aria-label="Close ad" style="${closeStyle}">x</button>
<script type="text/javascript" src="js/body.js"></script>
</body>
</html>`;
}

function buildAdmixerBodyJs(mode: AdmixerMode): string {
  const vertical = mode === 'halfscreen' ? 'bottom' : 'center';
  const width = '100%';
  const height = mode === 'halfscreen' ? '30%' : '100%';
  return `globalHTML5Api.on('load', function () {
  function prevent(event) {
    if (!event) return;
    event.preventDefault && event.preventDefault();
    event.stopPropagation && event.stopPropagation();
    event.cancelBubble = true;
    event.returnValue = false;
  }

  globalHTML5Api.init({
    resize: [{
      name: 'state-1',
      fixed: { vertical: '${vertical}', horizontal: 'center' },
      width: '${width}',
      height: '${height}'
    }]
  });

  var close = document.getElementById('close');
  if (close) {
    close.onclick = function (event) {
      prevent(event);
      globalHTML5Api.close();
    };
  }

  var clickArea = document.getElementById('admixer-click-area') || document.body;
  clickArea.onclick = function (event) {
    prevent(event);
    globalHTML5Api.click('');
    ${mode === 'fullscreen' ? 'globalHTML5Api.close(true);' : ''}
  };

  document.body.onselectstart = function () { return false; };
});`;
}

function buildPreviewIndex(entryName: string, platformLabel: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${platformLabel} preview</title>
<style>
html,body{margin:0;width:100%;height:100%;background:#f4f6f6;font-family:Arial,sans-serif;}
iframe{display:block;margin:24px auto;border:0;background:#fff;max-width:100%;}
</style>
</head>
<body>
<iframe src="${entryName}" width="100%" height="640" title="${platformLabel} creative preview"></iframe>
</body>
</html>`;
}

function wrapBodyWithFusifyClick(html: string): string {
  const withoutDirectOpen = html.replace(/window\.open\((?:window\.)?clickTag[^)]*\)/gi, 'window.adPartner && adPartner.click ? adPartner.click() : false');
  const withScript = ensureHeadScript(withoutDirectOpen, '//a4p.adpartner.pro/apstc/media-iframe.min.js');
  const bodyInner = extractBodyInner(withScript);
  const wrapped = `<div id="adpartner-click-area" style="position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;" onclick="return window.adPartner && adPartner.click ? adPartner.click() : (window.open(window.clickTag, '_blank'), false);">
${bodyInner}
</div>`;
  return replaceBodyInner(withScript, wrapped);
}

function withClickHandler(html: string, expression: string): string {
  if (/addEventListener\(['"]click['"]/i.test(html)) {
    return html.replace(/window\.open\((?:window\.)?clickTag[^)]*\)/gi, expression);
  }

  const bodyInner = extractBodyInner(html);
  const wrapped = `<div id="banner-click-area" style="position:relative;width:100%;height:100%;cursor:pointer;" onclick="${expression}; return false;">
${bodyInner}
</div>`;
  return replaceBodyInner(html, wrapped);
}

function removeDv360PreviewScripts(html: string): string {
  return html
    .replace(/<script[^>]+src=["'][^"']*masonry[^"']*["'][^>]*><\/script>/gi, '')
    .replace(/<div[^>]+id=["']adblocker["'][\s\S]*?<\/div>/gi, '');
}

function upsertClickTag(html: string, landingUrl: string): string {
  const declaration = `<script type="text/javascript">var clickTag = "${landingUrl}";</script>`;
  if (/var\s+clickTag\s*=/.test(html)) {
    return html.replace(/<script[^>]*>\s*var\s+clickTag\s*=\s*["'][^"']*["'];?\s*<\/script>/i, declaration);
  }
  return html.replace(/<\/head>/i, `${declaration}\n</head>`);
}

function addHeadMeta(html: string, meta: Array<[string, string]>): string {
  let next = html;
  meta.forEach(([name, content]) => {
    const tag = `<meta name="${name}" content="${content}">`;
    const pattern = new RegExp(`<meta\\s+name=["']${escapeRegExp(name)}["'][^>]*>`, 'i');
    next = pattern.test(next) ? next.replace(pattern, tag) : next.replace(/<head[^>]*>/i, (head) => `${head}\n${tag}`);
  });
  return next;
}

function ensureHeadScript(html: string, src: string): string {
  if (html.includes(src)) {
    return html;
  }
  return html.replace(/<\/head>/i, `<script type="text/javascript" src="${src}"></script>\n</head>`);
}

function findCreativeEntry(htmlByPath: TextMap): string {
  const rootHtml = htmlByPath.get('index.html');
  const iframeSrc = rootHtml?.match(/<iframe[^>]+src=["']([^"']+\.html?)["']/i)?.[1];
  if (iframeSrc) {
    const resolved = normalizePath(iframeSrc);
    if (htmlByPath.has(resolved)) {
      return resolved;
    }
  }

  const adSizeEntry = [...htmlByPath.entries()].find(([, html]) => /<meta\s+name=["']ad\.size["']/i.test(html));
  if (adSizeEntry) {
    return adSizeEntry[0];
  }

  return [...htmlByPath.keys()].sort((a, b) => a.length - b.length)[0];
}

function extractAdSize(html: string): Pick<CreativeMetadata, 'width' | 'height'> {
  const meta = html.match(/<meta\s+name=["']ad\.size["']\s+content=["']width=(\d+),height=(\d+)["']/i);
  if (meta) {
    return { width: Number(meta[1]), height: Number(meta[2]) };
  }

  const container = html.match(/width:\s*(\d+)px[\s\S]{0,80}height:\s*(\d+)px/i);
  if (container) {
    return { width: Number(container[1]), height: Number(container[2]) };
  }

  return {};
}

function extractTitle(html: string): string | undefined {
  return html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || undefined;
}

function extractBodyInner(html: string): string {
  return html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
}

function extractHeadInner(html: string): string {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  return head
    .replace(/<meta\s+charset=["'][^"']*["']\s*\/?>/gi, '')
    .replace(/<meta\s+name=["']viewport["'][^>]*>/gi, '')
    .replace(/<script[^>]*>\s*var\s+clickTag[\s\S]*?<\/script>/gi, '')
    .trim();
}

function replaceBodyInner(html: string, inner: string): string {
  if (/<body/i.test(html)) {
    return html.replace(/<body([^>]*)>[\s\S]*?<\/body>/i, `<body$1>\n${inner}\n</body>`);
  }
  return `<!doctype html><html><head></head><body>${inner}</body></html>`;
}

function adSizeContent(html: string): string {
  const { width, height } = extractAdSize(html);
  return width && height ? `width=${width},height=${height}` : 'width=300,height=600';
}

function buildManifest(metadata: CreativeMetadata, platform: TargetPlatform, options: ConversionOptions) {
  return {
    generatedBy: 'Banner Forge',
    platform,
    sourceFileName: metadata.sourceFileName,
    sourceEntry: metadata.entryPath,
    sourceBasePath: metadata.basePath,
    width: metadata.width,
    height: metadata.height,
    landingUrl: options.landingUrl,
    admixerMode: platform === 'admixer' ? options.admixerMode : undefined,
    umhAutoButton: platform === 'umh' ? options.umhAutoButton : undefined,
    notes: [
      'Generated from a DV360 HTML5 zip.',
      'Review platform-specific weight limits and external resource policies before trafficking.'
    ]
  };
}

function stripBase(path: string, basePath: string): string {
  return basePath && path.startsWith(`${basePath}/`) ? path.slice(basePath.length + 1) : path;
}

function rewriteAssetPath(path: string, platform: TargetPlatform): string {
  if (platform === 'fusify') {
    return basename(path);
  }
  return path;
}

function flattenAssetReferences(html: string): string {
  return html.replace(/((?:src|href)=["'])([^"']+)(["'])/gi, (_match, prefix: string, url: string, suffix: string) => {
    if (isExternalUrl(url) || url.startsWith('#') || url.startsWith('data:')) {
      return `${prefix}${url}${suffix}`;
    }
    return `${prefix}${basename(url)}${suffix}`;
  }).replace(/url\((['"]?)([^'")]+)\1\)/gi, (_match, quote: string, url: string) => {
    if (isExternalUrl(url) || url.startsWith('data:')) {
      return `url(${quote}${url}${quote})`;
    }
    return `url(${quote}${basename(url)}${quote})`;
  });
}

function isExternalUrl(value: string): boolean {
  return /^(https?:)?\/\//i.test(value);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function isSystemFile(path: string): boolean {
  return /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX\/|\.gitkeep)/i.test(path) || /(^|\/)\._/.test(path);
}

function getSourceFileName(file: File | Blob): string {
  const named = file as File & { name?: string };
  return named.name || 'banner.zip';
}

function sourceBaseName(fileName: string): string {
  const withoutPath = fileName.replace(/\\/g, '/').split('/').pop() || 'banner.zip';
  const withoutZip = withoutPath.replace(/\.zip$/i, '');
  return safeFilePart(withoutZip);
}

function buildOutputFileName(sourceFileName: string, platform: TargetPlatform): string {
  const suffix = platform === 'umh' ? 'UMH' : platform === 'fusify' ? 'Fusify' : 'Admixer';
  return `${sourceBaseName(sourceFileName)}_${suffix}.zip`;
}

function safeFilePart(value: string): string {
  const cleaned = value.trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'banner';
}

function hasPlatformClickHook(html: string, platform: TargetPlatform): boolean {
  if (platform === 'umh') {
    return /admixAPI\.click|clickTag/i.test(html);
  }
  if (platform === 'fusify') {
    return /adPartner\.click/i.test(html);
  }
  return /globalHTML5Api\.click|admixer-click-area/i.test(html);
}

function labelPlatform(platform: TargetPlatform): string {
  return platform === 'umh' ? 'UMH' : platform === 'fusify' ? 'Fusify/AdPartner' : 'Admixer';
}

function escapeForScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\x3c');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
