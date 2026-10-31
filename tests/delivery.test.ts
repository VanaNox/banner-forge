import { it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { convertDv360Banner } from '../src/lib/converter';
import type { OutputPackage, TargetPlatform } from '../src/lib/types';

// Справжні DV360-ресайзи кампанії ZYN (листопад 2026), до яких фрілансер зробив
// еталонні UMH/Admixer пакети з двома макетами. Лежать у scratch/ (gitignored) —
// без них тест пропускається. DUMP=1 розпаковує результат у scratch/zyn/out.
const SRC = path.resolve(__dirname, '../scratch/zyn/src');
const OUT = path.resolve(__dirname, '../scratch/zyn/out');
const NAMES = ['DV360_492x696.zip', 'DV360_800x400.zip', 'DV360_1920x200.zip'];

const zip = (name: string) => new File([new Uint8Array(readFileSync(path.join(SRC, name)))], name, { type: 'application/zip' });

it.skipIf(!NAMES.every((name) => existsSync(path.join(SRC, name))))('builds the ZYN packages like the freelancer references', async () => {
  const opts = (targetPlatforms: TargetPlatform[]) => ({ landingUrl: 'https://example.com/zyn', targetPlatforms });
  const runs = [
    await convertDv360Banner(zip('DV360_492x696.zip'), opts(['umh', 'admixer']), zip('DV360_800x400.zip')),
    await convertDv360Banner(zip('DV360_800x400.zip'), opts(['umh', 'admixer', 'fusify']), zip('DV360_1920x200.zip')),
    await convertDv360Banner(zip('DV360_1920x200.zip'), opts(['umh', 'admixer']))
  ];
  const packages = runs.flatMap((run) => run.packages.filter((pkg): pkg is OutputPackage & { platform: TargetPlatform } => pkg.platform !== 'bundle'));

  const summary: string[] = [];
  for (const pkg of packages) {
    expect(pkg.validation.filter((check) => !check.passed).map((check) => `${pkg.fileName}: ${check.label}`)).toEqual([]);
    const archive = await JSZip.loadAsync(await pkg.blob.arrayBuffer());
    const names = Object.keys(archive.files).filter((name) => !archive.files[name].dir);
    const entry = names.includes('body.html') ? 'body.html' : 'index.html';
    const html = await archive.file(entry)!.async('text');

    // Кожне відносне посилання в entry має файл у пакеті.
    const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map((match) => match[1]).filter((url) => !/^(https?:)?\/\//.test(url));
    expect(refs.filter((ref) => !names.includes(ref)), pkg.fileName).toEqual([]);
    // id елементів у двох макетах не перетинаються.
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids.length, pkg.fileName).toBe(new Set(ids).size);

    const layouts = [...html.matchAll(/class="bf-layout" data-w="(\d+)" data-h="(\d+)"/g)].map((match) => `${match[1]}x${match[2]}`);
    summary.push(`${pkg.fileName}:${layouts.join('+')}`);

    if (process.env.DUMP) {
      const dir = path.join(OUT, pkg.fileName.replace(/\.zip$/, '').replace('@', '_at_'));
      for (const name of names) {
        mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        writeFileSync(path.join(dir, name), Buffer.from(await archive.file(name)!.async('uint8array')));
      }
    }
  }

  // Склад як в еталонах: fullscreen — два макети на обох; halfscreen — два лише в Admixer.
  expect(summary).toEqual([
    'banner_fullscreen@DV360_492x696.zip:492x696+800x400',
    'fullscreen_DV360_492x696_admixer.zip:492x696+800x400',
    'banner_halfscreen@DV360_800x400.zip:800x400',
    'halfscreen_DV360_800x400_admixer.zip:800x400+1920x200',
    'halfscreen_DV360_800x400_adpartner.zip:',
    'banner_catfish@DV360_1920x200.zip:1920x200',
    'catfish_DV360_1920x200_admixer.zip:1920x200'
  ]);
});
