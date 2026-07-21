import JSZip from 'jszip';
import { ADMIXER_HARNESS_FILES, ADMIXER_HARNESS_FOLDERS } from './admixerHarness';
import type { AdmixerMode, ConversionOptions, ConversionResult, CreativeMetadata, OutputPackage, TargetPlatform, UmhFormat, ValidationCheck } from './types';

const DEFAULT_OPTIONS: ConversionOptions = {
  landingUrl: 'https://www.google.com',
  admixerMode: 'fullscreen',
  umhFormat: 'standard',
  fusifyFormat: 'standard',
  umhAutoButton: true,
  targetPlatforms: ['umh', 'fusify', 'admixer']
};

const ADPARTNER_IFRAME_SRC = '//a4p.adpartner.pro/adpartner-iframe.min.js';
const FUSIFY_HALFSCREEN_CSS_FILE = 'for_halfscreen_style.css';

// Паритет із робочим adpartner-halfscreen еталоном: device-width zoom для фіксованого
// креативу. Значення відкалібровані під нативну halfscreen-ширину 800px (правило
// «подавати DV360-джерело правильного розміру»). Canvas-еталон робить це через
// makeResponsive; Bannerify-креатив фіксований у px, тож масштаб дають ці медіазапити.
const FUSIFY_HALFSCREEN_CSS = `@media (min-width: 319px) {
html, body {margin: 0 0 0 0;overflow: hidden; zoom:63.2%;}
@-moz-document url-prefix() {html {transform: scale(0.4); transform-origin: left top; width: calc(100% / 0.4); height: calc(100% / 0.4);}}
}
@media (min-width: 359px) {
html, body {margin: 0 0 0 0;overflow: hidden; zoom:67.1%;}
@-moz-document url-prefix() {html {transform: scale(0.45); transform-origin: left top; width: calc(100% / 0.45); height: calc(100% / 0.45);}}
}
@media (min-width: 374px) {
html, body {margin: 0 0 0 0;overflow: hidden; zoom:68.6%;}
@-moz-document url-prefix() {html {transform: scale(0.47); transform-origin: left top; width: calc(100% / 0.47); height: calc(100% / 0.47);}}
}
@media (min-width: 383px) {
html, body {margin: 0 0 0 0;overflow: hidden; zoom:69.4%;}
@-moz-document url-prefix() {html {transform: scale(0.48); transform-origin: left top; width: calc(100% / 0.48); height: calc(100% / 0.48);}}
}
@media (min-width: 389px) {
html, body {margin: 0 0 0 0;overflow: hidden; zoom:69.8%;}
@-moz-document url-prefix() {html {transform: scale(0.488); transform-origin: left top; width: calc(100% / 0.488); height: calc(100% / 0.488);}}
}
@media (min-width: 392px) {
html, body {margin: 0 0 0 0;overflow: hidden; zoom:70.1%;}
@-moz-document url-prefix() {html {transform: scale(0.492); transform-origin: left top; width: calc(100% / 0.492); height: calc(100% / 0.492);}}
}
@media (min-width: 411px) {
html, body {margin: 0 0 0 0;overflow: hidden; zoom:72%;}
@-moz-document url-prefix() {html {transform: scale(0.515); transform-origin: left top; width: calc(100% / 0.515); height: calc(100% / 0.515);}}
}
@media (min-width: 413px) {
html, body {margin: 0 0 0 0;overflow: hidden; zoom:72.2%;}
@-moz-document url-prefix() {html {transform: scale(0.5175); transform-origin: left top; width: calc(100% / 0.5175); height: calc(100% / 0.5175);}}
}
@media (min-width: 427px) {
html, body {margin: 0 0 0 0;overflow: hidden; zoom:73.2%;}
@-moz-document url-prefix() {html {transform: scale(0.535); transform-origin: left top; width: calc(100% / 0.535); height: calc(100% / 0.535);}}
}`;

type TextMap = Map<string, string>;
type AssetPathMap = Map<string, string>;

interface AssetPlan {
  files: Array<{
    sourcePath: string;
    outputPath: string;
  }>;
  pathMap: AssetPathMap;
}

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
  const entryName = platform === 'admixer' || (platform === 'fusify' && options.fusifyFormat === 'halfscreen') ? 'body.html' : 'index.html';
  const mode = platform === 'admixer' ? options.admixerMode : undefined;
  const assetPlan = buildAssetPlan(source, platform);
  const transformedHtml = transformHtmlWithAssets(source.entryHtml, platform, options, assetPlan.pathMap);
  const validation: ValidationCheck[] = [];

  for (const { sourcePath, outputPath } of assetPlan.files) {
    const entry = source.zip.file(sourcePath);
    if (entry) {
      out.file(outputPath, await entry.async('arraybuffer'));
    }
  }

  // AdPartner і UMH: виносимо великий inline-рантайм креативу в окремий JS, щоб
  // структура була index.html + <name>.js + assets, як у ручних Adobe Animate еталонах.
  let entryHtml = transformedHtml;
  let externalJsName: string | undefined;
  if (platform === 'fusify' || platform === 'umh') {
    const jsName = runtimeJsFileName(platform, options, source.metadata);
    const externalized = externalizeInlineRuntime(transformedHtml, jsName);
    if (externalized.js) {
      entryHtml = externalized.html;
      externalJsName = jsName;
      out.file(jsName, externalized.js);
    }
  }

  out.file(entryName, entryHtml);

  if (platform === 'admixer') {
    out.file('js/body.js', buildAdmixerBodyJs(mode ?? 'fullscreen', source.metadata.height));
    // Тестовий стенд index/ входить в обидва робочі еталони — без нього
    // превʼю-тул Admixer не може зібрати Settings для креативу.
    ADMIXER_HARNESS_FILES.forEach((file) => out.file(file.path, file.content));
    ADMIXER_HARNESS_FOLDERS.forEach((folder) => out.folder(folder));
  }

  const emitsHalfscreenCss = platform === 'fusify' && options.fusifyFormat === 'halfscreen';
  if (emitsHalfscreenCss) {
    // Паритет з еталоном: робочий adpartner-halfscreen пакет містить цей файл.
    out.file(FUSIFY_HALFSCREEN_CSS_FILE, FUSIFY_HALFSCREEN_CSS);
  }

  const blob = await out.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const outputEntries = [
    ...assetPlan.files.map((file) => file.outputPath),
    entryName,
    ...(externalJsName ? [externalJsName] : []),
    ...(platform === 'admixer' ? ['js/body.js', ...ADMIXER_HARNESS_FILES.map((file) => file.path)] : []),
    ...(emitsHalfscreenCss ? [FUSIFY_HALFSCREEN_CSS_FILE] : [])
  ];
  validation.push(...validatePlatformPackage(platform, outputEntries, entryHtml, blob.size, entryName, options));
  validation.filter((check) => !check.passed).forEach((check) => warnings.push(`${labelPlatform(platform)}: ${check.label}`));

  const sizeLimit = platformSizeLimit(platform);
  if (blob.size > sizeLimit) {
    warnings.push(`${labelPlatform(platform)} package is ${(blob.size / 1024).toFixed(1)} KB; verify the platform weight limit before trafficking.`);
  }

  const scalingNote = fixedSizeScalingNote(source.metadata, platform, options);
  if (scalingNote) {
    warnings.push(scalingNote);
  }

  return {
    platform,
    fileName: buildOutputFileName(source.metadata, platform, options),
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
  return transformHtmlWithAssets(html, platform, options, new Map());
}

function transformHtmlWithAssets(html: string, platform: TargetPlatform, options: ConversionOptions, assetPathMap: AssetPathMap): string {
  const landingUrl = escapeForScript(options.landingUrl || DEFAULT_OPTIONS.landingUrl);
  const normalized = rewriteAssetReferences(removeDv360PreviewScripts(html), assetPathMap, platform);

  if (platform === 'umh') {
    // DV360-превʼю лишає viewport із maximum-scale/user-scalable — у UMH-еталонах
    // його немає, тож прибираємо (структурний паритет).
    const cleaned = removeDv360PreviewViewport(normalized);
    // Коли ввімкнено auto_button, клік належить платформі: у робочих еталонах немає
    // ні clickTag, ні власного window.open у креативі. Якщо лишити обидва — виходить
    // подвійний перехід, тож прибираємо клік креативу і не інжектимо clickTag.
    // Коли auto_button вимкнено — клік веде креатив через переданий clickTag.
    const clickReady = options.umhAutoButton
      ? removeClickTagDeclaration(neutralizeDirectClicks(cleaned))
      : upsertClickTag(cleaned, landingUrl);
    return addHeadMeta(clickReady, [
      ['ad.type', 'banner'],
      ['ad.size', umhAdSizeContent(html, options.umhFormat)],
      ['ad.vars', umhAdVars(html, options)]
    ]);
  }

  if (platform === 'fusify') {
    // DV360-превʼю лишає viewport із maximum-scale/user-scalable — у ручних
    // AdPartner-еталонах його немає, тож прибираємо (для halfscreen далі
    // додається чистий width=device-width viewport).
    const cleaned = removeDv360PreviewViewport(normalized);
    if (options.fusifyFormat === 'halfscreen') {
      return buildFusifyHalfscreenHtml(cleaned, html);
    }
    // Стандартні розміри AdPartner приймає як звичайний креатив без власного API.
    return upsertClickTag(cleaned, landingUrl);
  }

  return buildAdmixerHtml(normalized, options.admixerMode);
}

function buildFusifyHalfscreenHtml(html: string, originalHtml: string): string {
  const neutralized = removeClickTagDeclaration(neutralizeDirectClicks(html));
  const withScript = ensureHeadScript(ensureViewportMeta(neutralized), ADPARTNER_IFRAME_SRC);
  const withCss = ensureHeadStylesheet(withScript, FUSIFY_HALFSCREEN_CSS_FILE);
  const withMeta = addHeadMeta(withCss, [
    ['ad.size', adSizeContent(originalHtml)]
  ]);
  const { width, height } = extractAdSize(originalHtml);
  const bodyInner = extractBodyInner(withMeta);
  // Центруємо фіксований креатив у контейнері так само, як canvas-еталон
  // (#animation_container{margin:auto;left/right/top/bottom:-100%}); масштаб під
  // ширину пристрою дає for_halfscreen_style.css.
  const centerStyle = width && height
    ? `position:absolute;margin:auto;left:-100%;right:-100%;top:-100%;bottom:-100%;width:${width}px;height:${height}px;`
    : 'position:absolute;margin:auto;left:-100%;right:-100%;top:-100%;bottom:-100%;';
  const wrapped = `<div id="container" style="position:absolute;left:0;top:0;width:100%;height:100%;" onclick="return adPartner.click();">
<div class="ap-halfscreen-stage" style="${centerStyle}">
${bodyInner}
</div>
</div>`;
  return replaceBodyInner(withMeta, wrapped);
}

function buildAdmixerHtml(html: string, mode: AdmixerMode): string {
  // Кліки має рахувати globalHTML5Api.click() з js/body.js — прямий window.open
  // обходить трекінг Admixer, а clickTag у head платформа не передає.
  const neutralized = neutralizeDirectClicks(html);
  const bodyInner = extractBodyInner(neutralized);
  const headInner = extractHeadInner(neutralized);
  const closeClass = mode === 'fullscreen' ? 'admix-close-button' : 'ad-close-button';
  // CatFish: кнопка закриття у правому верхньому куті з відступом мінімум 5px (вимога доків).
  const closeStyle = mode === 'fullscreen'
    ? 'position:absolute;width:20px;height:20px;left:0;top:0;z-index:9999;cursor:pointer;'
    : mode === 'catfish'
      ? 'position:absolute;width:24px;height:24px;right:5px;top:5px;z-index:9999;cursor:pointer;'
      : 'position:absolute;width:24px;height:24px;right:0;top:0;z-index:9999;cursor:pointer;';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
${headInner}
</head>
<body style="margin:0;overflow:hidden;">
<div id="admixer-click-area" style="position:relative;width:100%;height:100%;">
${bodyInner}
</div>
<div class="${closeClass}" id="close" aria-label="Close ad" style="${closeStyle}"></div>
<script type="text/javascript" src="js/body.js"></script>
</body>
</html>`;
}

function buildAdmixerBodyJs(mode: AdmixerMode, creativeHeight?: number): string {
  const vertical = mode === 'fullscreen' ? 'center' : 'bottom';
  const width = '100%';
  // CatFish кріпиться знизу з фіксованою піксельною висотою креативу (еталон: 200px),
  // доки обмежують висоту 30% екрана.
  const height = mode === 'fullscreen' ? '100%' : mode === 'halfscreen' ? '30%' : `${creativeHeight || 200}px`;
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
    globalHTML5Api.close(true);
  };

  document.body.onselectstart = function () { return false; };
});`;
}

function neutralizeDirectClicks(html: string): string {
  return html.replace(/window\.open\((?:window\.)?clickTag[^)]*\)/gi, 'void 0');
}

function ensureViewportMeta(html: string): string {
  if (/<meta\s+name=["']viewport["']/i.test(html)) {
    return html;
  }
  return html.replace(/<head[^>]*>/i, (head) => `${head}\n<meta name="viewport" content="width=device-width, initial-scale=1.0">`);
}

function removeDv360PreviewScripts(html: string): string {
  return html
    .replace(/<script[^>]+src=["'][^"']*masonry[^"']*["'][^>]*><\/script>/gi, '')
    .replace(/<div[^>]+id=["']adblocker["'][\s\S]*?<\/div>/gi, '');
}

function upsertClickTag(html: string, landingUrl: string): string {
  const declaration = `<script type="text/javascript">var clickTag = window.clickTag || "${landingUrl}";</script>`;
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

function ensureHeadStylesheet(html: string, href: string): string {
  if (html.includes(href)) {
    return html;
  }
  return html.replace(/<\/head>/i, `<link rel="stylesheet" type="text/css" href="${href}">\n</head>`);
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
  // Використовується лише для Admixer body.html: charset ставимо свій,
  // а viewport/ad.size/clickTag — DV360-специфіка, якої немає в еталонах.
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  return head
    .replace(/<meta\s+charset=["'][^"']*["']\s*\/?>/gi, '')
    .replace(/<meta\s+name=["']viewport["'][^>]*>/gi, '')
    .replace(/<meta\s+name=["']ad\.size["'][^>]*>/gi, '')
    .replace(/<script[^>]*>\s*var\s+clickTag[\s\S]*?<\/script>/gi, '')
    .trim();
}

function replaceBodyInner(html: string, inner: string): string {
  if (/<body/i.test(html)) {
    return html.replace(/<body([^>]*)>[\s\S]*?<\/body>/i, `<body$1>\n${inner}\n</body>`);
  }
  return `<!doctype html><html><head></head><body>${inner}</body></html>`;
}

function buildAssetPlan(source: SourceCreative, platform: TargetPlatform): AssetPlan {
  const files: AssetPlan['files'] = [];
  const pathMap: AssetPathMap = new Map();
  const usedOutputPaths = new Set<string>();

  source.rootFiles.forEach((sourcePath) => {
    const relativePath = stripBase(sourcePath, source.metadata.basePath);
    if (!relativePath || isSystemFile(relativePath) || /\.html?$/i.test(relativePath)) {
      return;
    }

    const extension = extensionForPath(relativePath);
    if (!isAllowedAssetExtension(extension, platform)) {
      return;
    }

    const outputPath = uniqueOutputPath(safeAssetPath(relativePath, platform), usedOutputPaths);
    usedOutputPaths.add(outputPath.toLowerCase());
    files.push({ sourcePath, outputPath });
    pathMap.set(normalizePath(relativePath), outputPath);
    pathMap.set(normalizePath(sourcePath), outputPath);
    pathMap.set(basename(relativePath), platform === 'fusify' ? outputPath : basename(outputPath));
  });

  return { files, pathMap };
}

function validatePlatformPackage(platform: TargetPlatform, entries: string[], html: string, sizeBytes: number, entryName: string, options: ConversionOptions): ValidationCheck[] {
  const checks: ValidationCheck[] = [
    { label: `${entryName} is present at zip root`, passed: entries.includes(entryName) },
    { label: 'No preview.html or conversion-manifest.json in production zip', passed: !entries.some((entry) => /(^|\/)(preview\.html|conversion-manifest\.json)$/i.test(entry)) },
    { label: 'No macOS/system files', passed: !entries.some(isSystemFile) },
    { label: 'Only platform-supported file extensions', passed: entries.every((entry) => isAllowedEntryExtension(entry, platform)) },
    { label: 'Platform click API is wired', passed: hasPlatformClickHook(html, platform, options) },
    { label: `Package is under ${(platformSizeLimit(platform) / 1000).toFixed(0)} KB`, passed: sizeBytes <= platformSizeLimit(platform) }
  ];

  if (platform === 'umh') {
    const adSizePattern = options.umhFormat === 'standard'
      ? /<meta\s+name=["']ad\.size["']\s+content=["']width=\d+,height=\d+["']/i
      : new RegExp(`<meta\\s+name=["']ad\\.size["']\\s+content=["']${options.umhFormat}["']`, 'i');
    checks.push(
      { label: 'UMH required ad.type/ad.size/ad.vars metadata is present', passed: /<meta\s+name=["']ad\.type["'][^>]+content=["']banner["']/i.test(html) && adSizePattern.test(html) && /<meta\s+name=["']ad\.vars["']/i.test(html) },
      { label: 'UMH file names contain no spaces or non-latin characters', passed: entries.every(hasPlatformSafeName) },
      { label: 'clickTag keeps the platform-provided value (no hard override)', passed: !/var\s+clickTag\s*=\s*["']/.test(html) }
    );
  }

  if (platform === 'fusify') {
    checks.push({ label: 'Fusify/AdPartner archive has no folders', passed: entries.every((entry) => !entry.includes('/')) });
    if (options.fusifyFormat === 'halfscreen') {
      checks.push({ label: 'AdPartner iframe bridge is connected', passed: /a4p\.adpartner\.pro\/adpartner-iframe\.min\.js/i.test(html) });
    } else {
      checks.push({ label: 'Standard AdPartner creative carries no halfscreen API', passed: !/a4p\.adpartner\.pro|adPartner\.click/i.test(html) });
    }
  }

  if (platform === 'admixer') {
    checks.push(
      { label: 'Admixer body.js API bridge is present', passed: entries.includes('js/body.js') },
      { label: 'Admixer globalHTML5Api load/init/click/close flow is present', passed: /globalHTML5Api/i.test(html) || entries.includes('js/body.js') },
      { label: 'No direct window.open click bypassing globalHTML5Api', passed: !/window\.open\((?:window\.)?clickTag/i.test(html) },
      { label: 'Admixer index/ preview harness is bundled', passed: entries.includes('index/index.html') && entries.includes('index/settings.js') }
    );
  }

  return checks;
}

function adSizeContent(html: string): string {
  const { width, height } = extractAdSize(html);
  return width && height ? `width=${width},height=${height}` : 'width=300,height=600';
}

function fixedSizeScalingNote(metadata: CreativeMetadata, platform: TargetPlatform, options: ConversionOptions): string | undefined {
  const stretchFormat = platform === 'admixer'
    ? `Admixer ${options.admixerMode}`
    : platform === 'umh' && options.umhFormat !== 'standard'
      ? `UMH ${options.umhFormat}`
      : platform === 'fusify' && options.fusifyFormat === 'halfscreen'
        ? 'AdPartner halfscreen'
        : undefined;

  if (!stretchFormat || !metadata.width || !metadata.height) {
    return undefined;
  }
  return `${stretchFormat}: the DV360 creative is fixed at ${metadata.width}x${metadata.height}px and will not auto-scale to fill the placement. Review the preview before trafficking.`;
}

function umhAdSizeContent(html: string, format: UmhFormat): string {
  // Для fullscreen/halfscreen/catfish UMH чекає літеральне значення, а не width/height.
  if (format === 'fullscreen' || format === 'halfscreen' || format === 'catfish') {
    return format;
  }
  return adSizeContent(html);
}

function umhAdVars(html: string, options: ConversionOptions): string {
  const autoButton = options.umhAutoButton ? '1' : '0';
  if (options.umhFormat === 'catfish') {
    // CatFish на UMH — прилипла до низу смуга: ad.vars несе піксельну висоту показу.
    return `height=${umhCatfishHeight(html)},auto_button=${autoButton}`;
  }
  return `auto_button=${autoButton}`;
}

function umhCatfishHeight(html: string): number {
  const { height } = extractAdSize(html);
  return height && height > 0 && height <= 400 ? height : 120;
}

function removeClickTagDeclaration(html: string): string {
  return html.replace(/<script[^>]*>\s*var\s+clickTag[\s\S]*?<\/script>/gi, '');
}

function removeDv360PreviewViewport(html: string): string {
  // Прибираємо лише DV360-превʼю viewport (maximum-scale/user-scalable); чистий
  // width=device-width viewport не чіпаємо.
  return html.replace(/<meta\s+name=["']viewport["'][^>]*>\s*/gi, (tag) =>
    /maximum-scale|user-scalable/i.test(tag) ? '' : tag
  );
}

function creativeSizeToken(metadata: CreativeMetadata): string {
  return metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : 'creative';
}

function runtimeJsFileName(platform: TargetPlatform, options: ConversionOptions, metadata: CreativeMetadata): string {
  // UMH-еталони називають JS за форматом (Halfscreen.js / fullscreen.js / CatFish.js);
  // стандарт і AdPartner — за розміром креативу (<width>x<height>.js), як у їхніх еталонах.
  if (platform === 'umh') {
    if (options.umhFormat === 'fullscreen') return 'fullscreen.js';
    if (options.umhFormat === 'halfscreen') return 'Halfscreen.js';
    if (options.umhFormat === 'catfish') return 'CatFish.js';
  }
  return `${creativeSizeToken(metadata)}.js`;
}

// Виносить найбільший inline-<script> (рантайм анімації Bannerify) в окремий файл,
// замінюючи його на <script src="...">. Малі скрипти (напр. clickTag) лишаються.
function externalizeInlineRuntime(html: string, jsFileName: string): { html: string; js: string | null } {
  const scriptRe = /<script\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  let best: { full: string; body: string } | null = null;
  while ((match = scriptRe.exec(html)) !== null) {
    const body = match[1];
    if (!best || body.length > best.body.length) {
      best = { full: match[0], body };
    }
  }
  if (!best || best.body.trim().length < 400) {
    return { html, js: null };
  }
  const replacement = `<script type="text/javascript" src="${jsFileName}"></script>`;
  return { html: html.replace(best.full, replacement), js: best.body };
}

function stripBase(path: string, basePath: string): string {
  return basePath && path.startsWith(`${basePath}/`) ? path.slice(basePath.length + 1) : path;
}

function safeAssetPath(path: string, platform: TargetPlatform): string {
  if (platform === 'fusify') {
    return safeFileName(basename(path));
  }
  return normalizePath(path).split('/').map((segment, index, parts) => {
    return index === parts.length - 1 ? safeFileName(segment) : safeDirectoryName(segment);
  }).join('/');
}

function rewriteAssetReferences(html: string, assetPathMap: AssetPathMap, platform: TargetPlatform): string {
  return html.replace(/((?:src|href)=["'])([^"']+)(["'])/gi, (_match, prefix: string, url: string, suffix: string) => {
    if (isExternalUrl(url) || url.startsWith('#') || url.startsWith('data:')) {
      return `${prefix}${url}${suffix}`;
    }
    return `${prefix}${resolveOutputAssetPath(url, assetPathMap, platform)}${suffix}`;
  }).replace(/url\((['"]?)([^'")]+)\1\)/gi, (_match, quote: string, url: string) => {
    if (isExternalUrl(url) || url.startsWith('data:')) {
      return `url(${quote}${url}${quote})`;
    }
    return `url(${quote}${resolveOutputAssetPath(url, assetPathMap, platform)}${quote})`;
  });
}

function resolveOutputAssetPath(url: string, assetPathMap: AssetPathMap, platform: TargetPlatform): string {
  const { path, suffix } = splitUrlSuffix(normalizePath(url));
  const resolved = assetPathMap.get(path) || assetPathMap.get(basename(path));
  if (resolved) return `${resolved}${suffix}`;
  return `${platform === 'fusify' ? basename(path) : path}${suffix}`;
}

function splitUrlSuffix(value: string): { path: string; suffix: string } {
  const match = value.match(/^([^?#]+)([?#].*)?$/);
  return { path: match?.[1] || value, suffix: match?.[2] || '' };
}

function isAllowedEntryExtension(path: string, platform: TargetPlatform): boolean {
  return isAllowedAssetExtension(extensionForPath(path), platform);
}

function isAllowedAssetExtension(extension: string, platform: TargetPlatform): boolean {
  if (!extension) return false;
  if (platform === 'umh') {
    return ['css', 'js', 'gif', 'png', 'jpg', 'jpeg', 'svg', 'html', 'json', 'xml'].includes(extension);
  }
  if (platform === 'fusify') {
    return ['css', 'js', 'gif', 'png', 'jpg', 'jpeg', 'svg', 'html', 'json', 'xml', 'webm', 'mp4', 'woff', 'woff2', 'ttf', 'otf', 'eot'].includes(extension);
  }
  return ['css', 'js', 'gif', 'png', 'jpg', 'jpeg', 'svg', 'html', 'json', 'xml', 'webm', 'mp4', 'woff', 'woff2', 'ttf', 'otf', 'eot'].includes(extension);
}

function platformSizeLimit(platform: TargetPlatform): number {
  // UMH та Fusify/AdPartner: 500 KB; Admixer: 300 KB без відео.
  if (platform === 'umh' || platform === 'fusify') return 500_000;
  return 300_000;
}

function uniqueOutputPath(path: string, used: Set<string>): string {
  if (!used.has(path.toLowerCase())) return path;
  const dir = dirname(path);
  const file = basename(path);
  const extension = extensionForPath(file);
  const stem = extension ? file.slice(0, -(extension.length + 1)) : file;
  let index = 2;
  while (true) {
    const nextName = `${stem}${index}${extension ? `.${extension}` : ''}`;
    const nextPath = dir ? `${dir}/${nextName}` : nextName;
    if (!used.has(nextPath.toLowerCase())) return nextPath;
    index += 1;
  }
}

function safeDirectoryName(value: string): string {
  return safeNamePart(value.replace(/\.[^.]+$/, '')) || 'assets';
}

function safeFileName(value: string): string {
  const extension = extensionForPath(value);
  const stem = extension ? value.slice(0, -(extension.length + 1)) : value;
  return `${safeNamePart(stem) || 'asset'}${extension ? `.${extension}` : ''}`;
}

function safeNamePart(value: string): string {
  return value.normalize('NFKD').replace(/[^a-z0-9]+/gi, '');
}

function hasPlatformSafeName(path: string): boolean {
  return normalizePath(path).split('/').every((segment) => /^[A-Za-z0-9._-]+$/.test(segment) && !/\s/.test(segment));
}

function extensionForPath(path: string): string {
  const clean = splitUrlSuffix(path).path;
  const file = basename(clean);
  const index = file.lastIndexOf('.');
  return index > -1 ? file.slice(index + 1).toLowerCase() : '';
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

function buildOutputFileName(metadata: CreativeMetadata, platform: TargetPlatform, options: ConversionOptions): string {
  const base = sourceBaseName(metadata.sourceFileName);
  const size = metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : '300x600';

  if (platform === 'umh') {
    // Вимога UMH до імені архіву: banner_<size>@<name>.zip
    const token = options.umhFormat === 'standard' ? size : options.umhFormat;
    return `banner_${token}@${base}.zip`;
  }
  if (platform === 'fusify') {
    return options.fusifyFormat === 'halfscreen' ? `halfscreen_${base}_adpartner.zip` : `${size}_${base}_adpartner.zip`;
  }
  return `${options.admixerMode}_${base}_admixer.zip`;
}

function safeFilePart(value: string): string {
  const cleaned = value.trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'banner';
}

function hasPlatformClickHook(html: string, platform: TargetPlatform, options: ConversionOptions): boolean {
  if (platform === 'umh') {
    // Клік вішає платформа (auto_button) або креатив через переданий clickTag.
    return options.umhAutoButton || /clickTag/i.test(html);
  }
  if (platform === 'fusify') {
    return options.fusifyFormat === 'halfscreen' ? /adPartner\.click/i.test(html) : true;
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
