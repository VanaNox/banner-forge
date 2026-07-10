import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { convertDv360Banner, readSourceCreative, transformHtml } from '../src/lib/converter';

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

describe('transformHtml', () => {
  it('adds UMH banner metadata and preserves click tracking fallback', () => {
    const html = transformHtml(dv360Html, 'umh', {
      landingUrl: 'https://example.com/landing',
      admixerMode: 'fullscreen',
      umhAutoButton: true,
      targetPlatforms: ['umh', 'fusify', 'admixer']
    });

    expect(html).toContain('meta name="ad.type" content="banner"');
    expect(html).toContain('meta name="ad.size" content="width=300,height=600"');
    expect(html).toContain('meta name="ad.vars" content="auto_button=1"');
    expect(html).toContain('var clickTag = "https://example.com/landing"');
    expect(html).toContain('admixAPI.click');
  });

  it('flattens Fusify asset paths and routes clicks through AdPartner', () => {
    const html = transformHtml(dv360Html, 'fusify', {
      landingUrl: 'https://example.com/landing',
      admixerMode: 'fullscreen',
      umhAutoButton: true,
      targetPlatforms: ['umh', 'fusify', 'admixer']
    });

    expect(html).toContain('//a4p.adpartner.pro/adpartner-iframe.min.js');
    expect(html).toContain('adPartner.click');
    expect(html).toContain('src="frame 1.png"');
    expect(html).toContain('src="creative.js"');
    expect(html).not.toContain('images/frame 1.png');
  });

  it('creates Admixer body.html content with API close and click hooks', () => {
    const html = transformHtml(dv360Html, 'admixer', {
      landingUrl: 'https://example.com/landing',
      admixerMode: 'halfscreen',
      umhAutoButton: true,
      targetPlatforms: ['umh', 'fusify', 'admixer']
    });

    expect(html).toContain('id="admixer-click-area"');
    expect(html).toContain('id="close"');
    expect(html).toContain('src="js/body.js"');
  });
});

describe('convertDv360Banner', () => {
  it('builds three target packages and one download bundle', async () => {
    const result = await convertDv360Banner(await makeDv360File(), {
      landingUrl: 'https://example.com/landing',
      admixerMode: 'halfscreen'
    });

    expect(result.packages.map((pkg) => pkg.platform)).toEqual(['umh', 'fusify', 'admixer', 'bundle']);
    expect(result.packages.map((pkg) => pkg.fileName)).toEqual([
      'Levia_DV360_UMH.zip',
      'Levia_DV360_Fusify.zip',
      'Levia_DV360_Admixer.zip',
      'Levia_DV360_converted_bundle.zip'
    ]);
    expect(result.packages.every((pkg) => pkg.sizeBytes > 0)).toBe(true);
    expect(result.packages.every((pkg) => pkg.validation.length > 0)).toBe(true);
    expect(result.packages.filter((pkg) => pkg.platform !== 'bundle').every((pkg) => pkg.validation.every((check) => check.passed))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('external resources'))).toBe(false);
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
    const allEntries = [
      ...Object.keys(umhZip.files),
      ...Object.keys(fusifyZip.files),
      ...Object.keys(admixerZip.files)
    ];
    expect(allEntries.some((path) => path.startsWith('__MACOSX'))).toBe(false);
    expect(allEntries.some((path) => /preview\.html|conversion-manifest\.json/i.test(path))).toBe(false);
    expect(Object.keys(fusifyZip.files).filter((path) => !fusifyZip.files[path].dir).every((path) => !path.includes('/'))).toBe(true);
  });

  it('only builds selected target platforms', async () => {
    const result = await convertDv360Banner(await makeDv360File(), {
      landingUrl: 'https://example.com/landing',
      admixerMode: 'fullscreen',
      targetPlatforms: ['umh', 'admixer']
    });

    expect(result.packages.map((pkg) => pkg.platform)).toEqual(['umh', 'admixer', 'bundle']);
    expect(result.packages.map((pkg) => pkg.fileName)).toEqual([
      'Levia_DV360_UMH.zip',
      'Levia_DV360_Admixer.zip',
      'Levia_DV360_converted_bundle.zip'
    ]);
  });
});
