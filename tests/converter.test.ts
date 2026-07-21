import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { convertDv360Banner, readSourceCreative, transformHtml } from '../src/lib/converter';
import type { ConversionOptions } from '../src/lib/types';

const dv360Html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="ad.size" content="width=300,height=600">
<script type="text/javascript">var clickTag = "https://www.google.com";</script>
</head>
<body>
<div id="banner"><img src="images/frame 1.png"><script src="scripts/creative.js"></script></div>
<script>document.getElementById('banner').addEventListener('click', function () { window.open(window.clickTag); });</script>
</body>
</html>`;

const baseOptions: ConversionOptions = {
  landingUrl: 'https://example.com/landing',
  admixerMode: 'fullscreen',
  umhFormat: 'standard',
  fusifyFormat: 'standard',
  umhAutoButton: true,
  targetPlatforms: ['umh', 'fusify', 'admixer']
};

async function makeDv360Blob() {
  const zip = new JSZip();
  zip.file('index.html', '<iframe src="banners/Sampling_01_300x600/index.html"></iframe>');
  zip.file('banners/Sampling_01_300x600/index.html', dv360Html);
  zip.file('banners/Sampling_01_300x600/images/frame 1.png', 'fake-image');
  zip.file('banners/Sampling_01_300x600/scripts/creative.js', 'console.log("creative")');
  zip.file('__MACOSX/._index.html', 'metadata');
  return zip.generateAsync({ type: 'blob' });
}

async function makeDv360File(fileName = 'Levia_DV360.zip') {
  return new File([await makeDv360Blob()], fileName, { type: 'application/zip' });
}

// DV360 creative with a realistic large inline runtime + a DV360-preview viewport,
// so the AdPartner JS-externalization and viewport cleanup paths are exercised.
const dv360BigRuntime = `(function(){var pad="${'a'.repeat(1500)}";document.getElementById('b_1').addEventListener('click',function(){window.open(window.clickTag);});})();`;
const dv360BigHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<meta name="ad.size" content="width=300,height=250">
<script type="text/javascript">var clickTag = "https://www.google.com";</script>
</head>
<body>
<div id="b_1"><img src="images/logo.png"></div>
<script type="text/javascript">${dv360BigRuntime}</script>
</body>
</html>`;

async function makeBigDv360File(fileName = 'Levia_DV360.zip') {
  const zip = new JSZip();
  zip.file('index.html', dv360BigHtml);
  zip.file('images/logo.png', 'fake-image');
  return new File([await zip.generateAsync({ type: 'blob' })], fileName, { type: 'application/zip' });
}

describe('readSourceCreative', () => {
  it('resolves the nested DV360 iframe entrypoint and metadata', async () => {
    const source = await readSourceCreative(await makeDv360Blob());

    expect(source.metadata.entryPath).toBe('banners/Sampling_01_300x600/index.html');
    expect(source.metadata.basePath).toBe('banners/Sampling_01_300x600');
    expect(source.metadata.width).toBe(300);
    expect(source.metadata.height).toBe(600);
    expect(source.metadata.detectedClickTag).toBe(true);
  });
});

describe('transformHtml for UMH', () => {
  it('lets the platform own the click when auto_button is on (no clickTag, no window.open)', () => {
    const html = transformHtml(dv360Html, 'umh', baseOptions);

    expect(html).toContain('meta name="ad.type" content="banner"');
    expect(html).toContain('meta name="ad.size" content="width=300,height=600"');
    expect(html).toContain('meta name="ad.vars" content="auto_button=1"');
    // auto_button = платформа сама вішає клік: жодного clickTag чи window.open у креативі,
    // інакше отримуємо подвійний перехід (розбіжність із робочими еталонами).
    expect(html).not.toMatch(/var\s+clickTag\s*=/);
    expect(html).not.toContain('window.open(window.clickTag');
  });

  it('does not inject extra click wrappers around the creative', () => {
    const html = transformHtml(dv360Html, 'umh', baseOptions);

    expect(html).not.toContain('banner-click-area');
    expect(html).not.toContain('admixAPI');
  });

  it('uses the literal fullscreen/halfscreen/catfish ad.size for UMH special formats', () => {
    const fullscreen = transformHtml(dv360Html, 'umh', { ...baseOptions, umhFormat: 'fullscreen' });
    const halfscreen = transformHtml(dv360Html, 'umh', { ...baseOptions, umhFormat: 'halfscreen' });
    const catfish = transformHtml(dv360Html, 'umh', { ...baseOptions, umhFormat: 'catfish' });

    expect(fullscreen).toContain('meta name="ad.size" content="fullscreen"');
    expect(halfscreen).toContain('meta name="ad.size" content="halfscreen"');
    expect(catfish).toContain('meta name="ad.size" content="catfish"');
  });

  it('carries a pixel height in ad.vars for the UMH catfish strip', () => {
    const html = transformHtml(dv360Html, 'umh', { ...baseOptions, umhFormat: 'catfish' });

    expect(html).toMatch(/meta name="ad.vars" content="height=\d+,auto_button=1"/);
  });

  it('keeps the creative clickTag and click handler when auto_button is disabled', () => {
    const html = transformHtml(dv360Html, 'umh', { ...baseOptions, umhAutoButton: false });

    expect(html).toContain('meta name="ad.vars" content="auto_button=0"');
    // Без auto_button клік веде креатив через переданий платформою clickTag.
    expect(html).toContain('var clickTag = window.clickTag || "https://example.com/landing"');
    expect(html).toContain('window.open(window.clickTag)');
  });

  it('removes the DV360 preview viewport for UMH', () => {
    const withPreview = dv360Html.replace(
      '<meta charset="utf-8">',
      '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>'
    );
    const html = transformHtml(withPreview, 'umh', baseOptions);

    expect(html).not.toContain('maximum-scale');
    expect(html).not.toContain('user-scalable');
  });
});

describe('transformHtml for Fusify/AdPartner', () => {
  it('keeps standard banners as a plain creative without the halfscreen API', () => {
    const html = transformHtml(dv360Html, 'fusify', baseOptions);

    expect(html).not.toContain('a4p.adpartner.pro');
    expect(html).not.toContain('adPartner.click');
    expect(html).toContain('var clickTag = window.clickTag || "https://example.com/landing"');
    // Рідний обробник кліку креативу лишається робочим.
    expect(html).toContain('window.open(window.clickTag)');
  });

  it('flattens asset paths for the flat AdPartner archive', () => {
    const html = transformHtml(dv360Html, 'fusify', baseOptions);

    expect(html).toContain('src="frame 1.png"');
    expect(html).toContain('src="creative.js"');
    expect(html).not.toContain('images/frame 1.png');
  });

  it('removes the DV360 preview viewport for AdPartner', () => {
    const withPreview = dv360Html.replace(
      '<meta charset="utf-8">',
      '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>'
    );
    const html = transformHtml(withPreview, 'fusify', baseOptions);

    expect(html).not.toContain('maximum-scale');
    expect(html).not.toContain('user-scalable');
  });

  it('builds the halfscreen format around body.html conventions', () => {
    const html = transformHtml(dv360Html, 'fusify', { ...baseOptions, fusifyFormat: 'halfscreen' });

    expect(html).toContain('//a4p.adpartner.pro/adpartner-iframe.min.js');
    expect(html).toContain('onclick="return adPartner.click();"');
    expect(html).toContain('meta name="ad.size" content="width=300,height=600"');
    expect(html).toContain('meta name="viewport"');
    // Паритет з еталоном: лінк на for_halfscreen_style.css + центрувальна сцена.
    expect(html).toContain('for_halfscreen_style.css');
    expect(html).toContain('ap-halfscreen-stage');
    // Клік іде тільки через adPartner.click(), без window.open і власного clickTag.
    expect(html).not.toContain('window.open(window.clickTag');
    expect(html).not.toContain('var clickTag');
  });
});

describe('transformHtml for Admixer', () => {
  it('creates body.html content with API close and click hooks', () => {
    const html = transformHtml(dv360Html, 'admixer', { ...baseOptions, admixerMode: 'halfscreen' });

    expect(html).toContain('id="admixer-click-area"');
    expect(html).toContain('id="close"');
    expect(html).toContain('class="ad-close-button"');
    expect(html).toContain('src="js/body.js"');
  });

  it('places the CatFish close button in the upper right corner with a 5px margin', () => {
    const html = transformHtml(dv360Html, 'admixer', { ...baseOptions, admixerMode: 'catfish' });

    expect(html).toContain('class="ad-close-button"');
    expect(html).toContain('right:5px;top:5px');
  });

  it('routes clicks through globalHTML5Api instead of window.open', () => {
    const html = transformHtml(dv360Html, 'admixer', baseOptions);

    // window.open(clickTag) відкривав би undefined і обходив трекінг Admixer.
    expect(html).not.toContain('window.open(window.clickTag');
    expect(html).not.toContain('var clickTag');
    expect(html).toContain('class="admix-close-button"');
    // DV360-специфічні мета-теги в admixer-еталонах відсутні.
    expect(html).not.toContain('ad.size');
    expect(html).not.toContain('name="viewport"');
  });
});

describe('convertDv360Banner', () => {
  it('builds three target packages and one download bundle with platform naming', async () => {
    const result = await convertDv360Banner(await makeDv360File(), {
      landingUrl: 'https://example.com/landing',
      admixerMode: 'halfscreen'
    });

    expect(result.packages.map((pkg) => pkg.platform)).toEqual(['umh', 'fusify', 'admixer', 'bundle']);
    expect(result.packages.map((pkg) => pkg.fileName)).toEqual([
      'banner_300x600@Levia_DV360.zip',
      '300x600_Levia_DV360_adpartner.zip',
      'halfscreen_Levia_DV360_admixer.zip',
      'Levia_DV360_converted_bundle.zip'
    ]);
    expect(result.packages.every((pkg) => pkg.sizeBytes > 0)).toBe(true);
    expect(result.packages.filter((pkg) => pkg.platform !== 'bundle').every((pkg) => pkg.validation.every((check) => check.passed))).toBe(true);
  });

  it('names UMH fullscreen archives with the literal format token', async () => {
    const result = await convertDv360Banner(await makeDv360File(), {
      landingUrl: 'https://example.com/landing',
      umhFormat: 'fullscreen',
      targetPlatforms: ['umh']
    });

    expect(result.packages[0].fileName).toBe('banner_fullscreen@Levia_DV360.zip');
  });

  it('writes platform-specific zip entrypoints and removes macOS metadata', async () => {
    const result = await convertDv360Banner(await makeDv360Blob(), {
      landingUrl: 'https://example.com/landing',
      admixerMode: 'halfscreen'
    });

    const umhZip = await JSZip.loadAsync(result.packages.find((pkg) => pkg.platform === 'umh')!.blob);
    const fusifyZip = await JSZip.loadAsync(result.packages.find((pkg) => pkg.platform === 'fusify')!.blob);
    const admixerZip = await JSZip.loadAsync(result.packages.find((pkg) => pkg.platform === 'admixer')!.blob);

    expect(umhZip.file('index.html')).toBeTruthy();
    expect(fusifyZip.file('index.html')).toBeTruthy();
    expect(fusifyZip.file('frame1.png')).toBeTruthy();
    expect(fusifyZip.file('images/frame 1.png')).toBeNull();
    expect(admixerZip.file('body.html')).toBeTruthy();
    expect(admixerZip.file('js/body.js')).toBeTruthy();
    expect(await admixerZip.file('js/body.js')!.async('text')).toContain('globalHTML5Api.close(true)');
    // Стенд index/ обовʼязковий: превʼю-тул Admixer читає з нього Settings.
    expect(admixerZip.file('index/index.html')).toBeTruthy();
    expect(admixerZip.file('index/settings.js')).toBeTruthy();
    expect(admixerZip.file('index/css/index.css')).toBeTruthy();
    expect(await admixerZip.file('index/index.html')!.async('text')).toContain('"TemplateId\\":52');
    const allEntries = [
      ...Object.keys(umhZip.files),
      ...Object.keys(fusifyZip.files),
      ...Object.keys(admixerZip.files)
    ];
    expect(allEntries.some((path) => path.startsWith('__MACOSX'))).toBe(false);
    expect(Object.keys(fusifyZip.files).filter((path) => !fusifyZip.files[path].dir).every((path) => !path.includes('/'))).toBe(true);
  });

  it('builds a bottom-anchored fixed-height body.js for the Admixer CatFish format', async () => {
    const result = await convertDv360Banner(await makeDv360File(), {
      landingUrl: 'https://example.com/landing',
      admixerMode: 'catfish',
      targetPlatforms: ['admixer']
    });

    const output = result.packages[0];
    expect(output.fileName).toBe('catfish_Levia_DV360_admixer.zip');
    const zip = await JSZip.loadAsync(output.blob);
    const bodyJs = await zip.file('js/body.js')!.async('text');
    // Висота CatFish — фіксована піксельна висота креативу, кріплення знизу по центру.
    expect(bodyJs).toContain("vertical: 'bottom'");
    expect(bodyJs).toContain("height: '600px'");
    expect(output.validation.every((check) => check.passed)).toBe(true);
  });

  it('emits body.html for the AdPartner halfscreen format', async () => {
    const result = await convertDv360Banner(await makeDv360File(), {
      landingUrl: 'https://example.com/landing',
      fusifyFormat: 'halfscreen',
      targetPlatforms: ['fusify']
    });

    const output = result.packages[0];
    expect(output.fileName).toBe('halfscreen_Levia_DV360_adpartner.zip');
    const zip = await JSZip.loadAsync(output.blob);
    expect(zip.file('body.html')).toBeTruthy();
    expect(zip.file('index.html')).toBeNull();
    const body = await zip.file('body.html')!.async('text');
    expect(body).toContain('adPartner.click()');
    // Паритет з еталоном adpartner-halfscreen: файл стилю присутній і підключений.
    expect(zip.file('for_halfscreen_style.css')).toBeTruthy();
    expect(body).toContain('for_halfscreen_style.css');
    // Пакет AdPartner лишається пласким (без тек).
    expect(Object.keys(zip.files).filter((path) => !zip.files[path].dir).every((path) => !path.includes('/'))).toBe(true);
    expect(output.validation.every((check) => check.passed)).toBe(true);
  });

  it('builds a UMH catfish package with the catfish token and metadata', async () => {
    const result = await convertDv360Banner(await makeDv360File(), {
      landingUrl: 'https://example.com/landing',
      umhFormat: 'catfish',
      targetPlatforms: ['umh']
    });

    const output = result.packages[0];
    expect(output.fileName).toBe('banner_catfish@Levia_DV360.zip');
    const zip = await JSZip.loadAsync(output.blob);
    const html = await zip.file('index.html')!.async('text');
    expect(html).toContain('meta name="ad.size" content="catfish"');
    expect(html).toMatch(/meta name="ad.vars" content="height=\d+,auto_button=1"/);
    expect(output.validation.every((check) => check.passed)).toBe(true);
  });

  it('externalizes the UMH runtime into a format-named .js file at the root', async () => {
    const half = await convertDv360Banner(await makeBigDv360File(), {
      landingUrl: 'https://example.com/landing',
      umhFormat: 'halfscreen',
      targetPlatforms: ['umh']
    });
    const halfZip = await JSZip.loadAsync(half.packages[0].blob);
    // UMH-еталон називає файл за форматом.
    expect(halfZip.file('Halfscreen.js')).toBeTruthy();
    const halfHtml = await halfZip.file('index.html')!.async('text');
    expect(halfHtml).toContain('src="Halfscreen.js"');
    expect(halfHtml).not.toContain('a'.repeat(1500));
    expect(halfHtml).not.toContain('maximum-scale');
    expect(half.packages[0].validation.every((c) => c.passed)).toBe(true);

    // Стандартний формат — за розміром креативу.
    const std = await convertDv360Banner(await makeBigDv360File(), {
      landingUrl: 'https://example.com/landing',
      umhFormat: 'standard',
      targetPlatforms: ['umh']
    });
    const stdZip = await JSZip.loadAsync(std.packages[0].blob);
    expect(stdZip.file('300x250.js')).toBeTruthy();
    expect(await stdZip.file('index.html')!.async('text')).toContain('src="300x250.js"');
  });

  it('externalizes the AdPartner creative runtime into a size-named .js file', async () => {
    const result = await convertDv360Banner(await makeBigDv360File(), {
      landingUrl: 'https://example.com/landing',
      fusifyFormat: 'standard',
      targetPlatforms: ['fusify']
    });

    const zip = await JSZip.loadAsync(result.packages[0].blob);
    expect(zip.file('300x250.js')).toBeTruthy();
    const html = await zip.file('index.html')!.async('text');
    // Рантайм винесено в окремий файл і підключено через <script src>.
    expect(html).toContain('src="300x250.js"');
    expect(html).not.toContain('a'.repeat(1500));
    const js = await zip.file('300x250.js')!.async('text');
    expect(js).toContain('addEventListener');
    // DV360-превʼю viewport прибрано.
    expect(html).not.toContain('maximum-scale');
    // Плаский архів без тек.
    expect(Object.keys(zip.files).filter((path) => !zip.files[path].dir).every((path) => !path.includes('/'))).toBe(true);
    expect(result.packages[0].validation.every((check) => check.passed)).toBe(true);
  });

  it('externalizes the runtime for the AdPartner halfscreen format too', async () => {
    const result = await convertDv360Banner(await makeBigDv360File(), {
      landingUrl: 'https://example.com/landing',
      fusifyFormat: 'halfscreen',
      targetPlatforms: ['fusify']
    });

    const zip = await JSZip.loadAsync(result.packages[0].blob);
    expect(zip.file('300x250.js')).toBeTruthy();
    const body = await zip.file('body.html')!.async('text');
    expect(body).toContain('src="300x250.js"');
    // Прев'ю-viewport прибрано, натомість доданий чистий width=device-width.
    expect(body).not.toContain('maximum-scale');
    expect(body).toContain('meta name="viewport"');
    expect(result.packages[0].validation.every((check) => check.passed)).toBe(true);
  });

  it('only builds selected target platforms', async () => {
    const result = await convertDv360Banner(await makeDv360File(), {
      landingUrl: 'https://example.com/landing',
      admixerMode: 'fullscreen',
      targetPlatforms: ['umh', 'admixer']
    });

    expect(result.packages.map((pkg) => pkg.platform)).toEqual(['umh', 'admixer', 'bundle']);
    expect(result.packages.map((pkg) => pkg.fileName)).toEqual([
      'banner_300x600@Levia_DV360.zip',
      'fullscreen_Levia_DV360_admixer.zip',
      'Levia_DV360_converted_bundle.zip'
    ]);
  });
});

// samples/ holds real client creatives and is gitignored on purpose (not for the public repo),
// so this suite only runs when a developer has it locally — CI always skips it.
const REAL_SAMPLE_PATH = path.resolve(__dirname, '../samples/Levia_DV360.zip');

describe.skipIf(!existsSync(REAL_SAMPLE_PATH))('convertDv360Banner with the real Levia_DV360 sample', () => {
  async function convertRealSample(options?: Partial<ConversionOptions>) {
    const buffer = readFileSync(REAL_SAMPLE_PATH);
    const file = new File([buffer], 'Levia_DV360.zip', { type: 'application/zip' });
    return convertDv360Banner(file, { landingUrl: 'https://example.com/landing', ...options });
  }

  it('passes every package validation check', async () => {
    const result = await convertRealSample();

    for (const pkg of result.packages.filter((item) => item.platform !== 'bundle')) {
      const failed = pkg.validation.filter((check) => !check.passed).map((check) => check.label);
      expect(failed, `${pkg.platform} failed: ${failed.join(', ')}`).toEqual([]);
    }
  });

  it('rewrites every image reference in the flat AdPartner archive', async () => {
    const result = await convertRealSample();
    const fusify = result.packages.find((pkg) => pkg.platform === 'fusify')!;
    const zip = await JSZip.loadAsync(fusify.blob);
    const html = await zip.file('index.html')!.async('text');

    expect(html).not.toContain('images/');
    const referenced = [...html.matchAll(/src="([^"]+\.(?:svg|png|jpg))"/g)].map((match) => match[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const asset of referenced) {
      expect(zip.file(asset), `${asset} referenced but missing in zip`).toBeTruthy();
    }
  });

  it('keeps Admixer output under the 300 KB platform limit', async () => {
    const result = await convertRealSample();
    const admixer = result.packages.find((pkg) => pkg.platform === 'admixer')!;

    expect(admixer.sizeBytes).toBeLessThanOrEqual(300_000);
    const zip = await JSZip.loadAsync(admixer.blob);
    const body = await zip.file('body.html')!.async('text');
    expect(body).not.toContain('window.open(window.clickTag');
  });
});
