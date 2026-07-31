import { it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { convertDv360Banner } from '../src/lib/converter';
import { isFixedFormat } from '../src/lib/formatMatrix';
import type { ConversionOptions, FormatKey } from '../src/lib/types';

const SRC = path.resolve(__dirname, "../scratch/emul/src");

type Case = {
  src: string;
  label: string;
  opts: Partial<ConversionOptions>;
  expectEntry: string;
  expectJs: string;
  expectExtra?: string[];
};

const FIXED = ['300x250', '300x600', '320x100', '336x280', '728x90'];

const cases: Case[] = [
  // ---- fixed sizes -> AdPartner standard + UMH standard
  ...FIXED.flatMap((size): Case[] => [
    {
      src: `Sampling_02_${size}.zip`, label: `adp-standard ${size}`,
      opts: { targetPlatforms: ['fusify'], formatKey: size as FormatKey },
      expectEntry: 'index.html', expectJs: `${size}.js`
    },
    {
      src: `Sampling_02_${size}.zip`, label: `umh-standard ${size}`,
      opts: { targetPlatforms: ['umh'], formatKey: size as FormatKey },
      expectEntry: 'index.html', expectJs: `${size}.js`
    }
  ]),
  // ---- fluid sources at their native size
  {
    src: 'Sampling_01_320x480_Fullscreen.zip', label: 'umh-fullscreen 320x480',
    opts: { targetPlatforms: ['umh'], formatKey: 'fullscreen' },
    expectEntry: 'index.html', expectJs: 'fullscreen.js'
  },
  {
    src: 'Sampling_01_320x480_Fullscreen.zip', label: 'admx-fullscreen 320x480',
    opts: { targetPlatforms: ['admixer'], formatKey: 'fullscreen' },
    expectEntry: 'body.html', expectJs: 'js/fullscreen.js',
    expectExtra: ['js/body.js', 'index/index.html', 'index/settings.js', 'index/css/index.css']
  },
  {
    src: 'Sampling_01_800x400_Halfscreen.zip', label: 'adp-halfscreen 800x400',
    opts: { targetPlatforms: ['fusify'], formatKey: 'halfscreen' },
    expectEntry: 'body.html', expectJs: 'Halfscreen.js',
    expectExtra: ['for_halfscreen_style.css']
  },
  {
    src: 'Sampling_01_800x400_Halfscreen.zip', label: 'umh-halfscreen 800x400',
    opts: { targetPlatforms: ['umh'], formatKey: 'halfscreen' },
    expectEntry: 'index.html', expectJs: 'Halfscreen.js'
  },
  {
    src: 'Sampling_01_800x400_Halfscreen.zip', label: 'admx-halfscreen 800x400',
    opts: { targetPlatforms: ['admixer'], formatKey: 'halfscreen' },
    expectEntry: 'body.html', expectJs: 'js/half.js',
    expectExtra: ['js/body.js', 'index/index.html', 'index/settings.js', 'index/css/index.css']
  },
  {
    src: 'Sampling_01_1920x200_Catfish.zip', label: 'umh-catfish 1920x200',
    opts: { targetPlatforms: ['umh'], formatKey: 'catfish' },
    expectEntry: 'index.html', expectJs: 'CatFish.js'
  },
  {
    src: 'Sampling_01_1920x200_Catfish.zip', label: 'admx-catfish 1920x200',
    opts: { targetPlatforms: ['admixer'], formatKey: 'catfish' },
    expectEntry: 'body.html', expectJs: 'js/catfish.js',
    expectExtra: ['js/body.js', 'index/index.html', 'index/settings.js', 'index/css/index.css']
  }
];

function referencedAssets(html: string): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    if (!u) return;
    if (/^(https?:)?\/\//i.test(u) || u.startsWith('data:') || u.startsWith('#') || u.startsWith('blob:')) return;
    out.push(u.replace(/^\.\//, '').split(/[?#]/)[0]);
  };
  for (const m of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/url\((['"]?)([^'")]+)\1\)/gi)) push(m[2]);
  return [...new Set(out)];
}

it.skipIf(!existsSync(SRC))('emulates DV360 -> 3 platforms for every real source', async () => {
  const available = new Set(readdirSync(SRC));
  const rows: string[] = [];
  const failures: string[] = [];

  for (const c of cases) {
    if (!available.has(c.src)) { failures.push(`${c.label}: MISSING SOURCE ${c.src}`); continue; }
    const buf = readFileSync(path.join(SRC, c.src));
    const file = new File([new Uint8Array(buf)], c.src, { type: 'application/zip' });

    const result = await convertDv360Banner(file, { landingUrl: 'https://example.com/l', ...c.opts });
    const pkg = result.packages.find((p) => p.platform !== 'bundle')!;
    const zip = await JSZip.loadAsync(await pkg.blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

    const problems: string[] = [];

    // 1. entry present
    if (!names.includes(c.expectEntry)) problems.push(`no ${c.expectEntry}`);
    // 2. creative JS named per reference convention
    if (!names.includes(c.expectJs)) problems.push(`JS != ${c.expectJs} (got ${names.filter((n) => n.endsWith('.js')).join(',') || 'none'})`);
    // 3. platform extras
    for (const extra of c.expectExtra ?? []) if (!names.includes(extra)) problems.push(`missing ${extra}`);

    const html = await zip.file(c.expectEntry)!.async('text');

    // 4. runtime really externalized + wired
    if (names.includes(c.expectJs)) {
      const js = await zip.file(c.expectJs)!.async('text');
      if (js.trim().length < 400) problems.push('external JS suspiciously small');
      if (!html.includes(`src="${c.expectJs}"`)) problems.push('external JS not referenced');
    }
    // Тіло inline-скрипта не має перетинати </script>, інакше regex зшиває
    // сусідні блоки через inline <style> і дає хибний фейл.
    const inlineBodies = [...html.matchAll(/<script\b(?![^>]*\ssrc=)[^>]*>((?:(?!<\/script>)[\s\S])*)<\/script>/gi)].map((m) => m[1].trim());
    const leftoverRuntime = inlineBodies.find((b) => b.length > 600);
    if (leftoverRuntime) problems.push(`inline runtime still present (${leftoverRuntime.length} chars)`);

    // 5. ASSET INTEGRITY: every referenced relative asset exists in the zip
    const missing = referencedAssets(html).filter((a) => !names.includes(a));
    if (missing.length) problems.push(`broken refs: ${missing.slice(0, 4).join(',')}`);

    // 6. no orphan assets (everything shipped is referenced) - informational
    const imgs = names.filter((n) => /\.(png|jpe?g|svg|gif)$/i.test(n));
    const refs = new Set(referencedAssets(html));
    const orphans = imgs.filter((i) => !refs.has(i));

    // 7. hygiene
    if (names.some((n) => /__MACOSX|\.DS_Store|Thumbs\.db/i.test(n))) problems.push('system files');
    if (pkg.platform === 'fusify' && names.some((n) => n.includes('/'))) problems.push('adpartner not flat');
    // 8. internal validation. Вага пакета залежить від ваги ассетів у джерелі,
    // а не від пакування, тож ліміт розміру відзначаємо окремо (не структурний фейл).
    const bad = pkg.validation.filter((v) => !v.passed).map((v) => v.label);
    const overweight = bad.filter((l) => /under \d+ KB/.test(l));
    const structural = bad.filter((l) => !/under \d+ KB/.test(l));
    if (structural.length) problems.push(`validation: ${structural.join('; ')}`);

    // 9. platform meta contract
    if (pkg.platform === 'umh') {
      if (!/name="ad\.type" content="banner"/.test(html)) problems.push('no ad.type');
      if (!/name="ad\.vars"/.test(html)) problems.push('no ad.vars');
      const fmt = c.opts.formatKey!;
      const wantSize = isFixedFormat(fmt) ? /name="ad\.size" content="width=\d+,height=\d+"/ : new RegExp(`name="ad\\.size" content="${fmt}"`);
      if (!wantSize.test(html)) problems.push('bad ad.size');
      if (/maximum-scale|user-scalable/.test(html)) problems.push('DV360 preview viewport left');
    }
    if (pkg.platform === 'fusify' && c.opts.formatKey === 'halfscreen') {
      if (!/adPartner\.click\(\)/.test(html)) problems.push('no adPartner.click');
      if (!/a4p\.adpartner\.pro/.test(html)) problems.push('no adpartner bridge');
    }
    if (pkg.platform === 'admixer') {
      const bodyJs = await zip.file('js/body.js')!.async('text');
      if (!/globalHTML5Api\.init/.test(bodyJs)) problems.push('body.js missing init');
      if (!/globalHTML5Api\.click/.test(bodyJs)) problems.push('body.js missing click');
      if (!/globalHTML5Api\.close/.test(bodyJs)) problems.push('body.js missing close');
      if (!/id="close"/.test(html)) problems.push('no close button');
      const wantV = c.opts.formatKey === 'fullscreen' ? "vertical: 'center'" : "vertical: 'bottom'";
      if (!bodyJs.includes(wantV)) problems.push(`body.js anchor != ${wantV}`);
    }

    const status = problems.length ? 'FAIL' : overweight.length ? 'WARN' : 'OK';
    rows.push(
      `${status.padEnd(4)} ${c.label.padEnd(26)} ${pkg.fileName.padEnd(42)} ` +
      `${(pkg.sizeBytes / 1024).toFixed(0).padStart(4)}KB files:${String(names.length).padStart(2)} ` +
      `orphans:${orphans.length}` +
      (overweight.length ? '  [over platform weight limit - source assets too heavy]' : '') +
      (problems.length ? `  <<< ${problems.join(' | ')}` : '')
    );
    if (problems.length) failures.push(`${c.label}: ${problems.join(' | ')}`);
  }

  console.log('\n================ DV360 -> PLATFORM EMULATION ================');
  console.log(rows.join('\n'));
  console.log(`\nTOTAL: ${rows.length} cases, ${failures.length} failing`);
  if (failures.length) console.log('FAILURES:\n' + failures.map((f) => ' - ' + f).join('\n'));
  expect(failures, `\n${failures.join('\n')}`).toEqual([]);
});
