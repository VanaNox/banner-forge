import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  HelpCircle,
  Hexagon,
  Layers,
  Loader2,
  Lock,
  Monitor,
  Moon,
  PackageCheck,
  Play,
  RefreshCw,
  Settings,
  Smartphone,
  Sun,
  UploadCloud,
  Wrench,
  X
} from 'lucide-react';
import { convertDv360Banner, readSourceCreative } from './lib/converter';
import {
  FORMAT_MATRIX,
  acceptedSizes,
  acceptsSize,
  describeSizes,
  formatSpec,
  platformsForFormat,
  takesSecondLayout,
  type Dimensions
} from './lib/formatMatrix';
import { createPackagePreviewUrl } from './lib/preview';
import type { ConversionOptions, ConversionResult, CreativeMetadata, FormatKey, OutputPackage, TargetPlatform } from './lib/types';

const ALL_PLATFORMS: TargetPlatform[] = ['umh', 'fusify', 'admixer'];

const initialOptions: ConversionOptions = {
  landingUrl: 'https://www.example.com/summer-sale',
  formatKey: 'halfscreen',
  // Клік веде креатив через clickTag; увімкни, щоб віддати клік платформі UMH.
  umhAutoButton: false,
  targetPlatforms: platformsForFormat('halfscreen')
};

type PreviewState = {
  packageName: string;
  platform: TargetPlatform;
  url: string;
};

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  const saved = localStorage.getItem('bf-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<CreativeMetadata | null>(null);
  const [options, setOptions] = useState<ConversionOptions>(initialOptions);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [activeDialog, setActiveDialog] = useState<'settings' | 'help' | 'validation' | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [toast, setToast] = useState<string | null>(null);
  // Формат зафіксовано розпізнаванням; користувач може розблокувати й переобрати вручну.
  const [formatLocked, setFormatLocked] = useState(false);
  // Другий (ширший) ресайз адаптивного пакета — задається лише через модалку Combine.
  const [secondFile, setSecondFile] = useState<File | null>(null);
  const [secondMetadata, setSecondMetadata] = useState<CreativeMetadata | null>(null);
  // Відкрита модалка Combine і чим її заповнити (два кинуті разом zip або поточна пара).
  const [combineSeed, setCombineSeed] = useState<CombineSlot[] | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('bf-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const activeMetadata = result?.metadata ?? metadata;
  const sourceSize = creativeSize(activeMetadata);
  const activeFormat = formatSpec(options.formatKey);
  const platformPackages = useMemo(
    () => result?.packages.filter((pkg): pkg is OutputPackage & { platform: TargetPlatform } => pkg.platform !== 'bundle') ?? [],
    [result]
  );
  const bundlePackage = result?.packages.find((pkg) => pkg.platform === 'bundle');
  const criticalWarnings = result?.warnings ?? [];
  const completedChecks = result ? platformPackages.flatMap((pkg) => pkg.validation).filter((check) => check.passed).length : 0;
  const totalChecks = result ? platformPackages.flatMap((pkg) => pkg.validation).length : 0;

  function clearPreview() {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setPreviewError(null);
  }

  function updateOptions(nextOptions: ConversionOptions) {
    setOptions(nextOptions);
    setResult(null);
    clearPreview();
  }

  async function handleFile(nextFile?: File) {
    if (!nextFile) return;
    setFile(nextFile);
    // Звичайне завантаження одного zip — це знову один макет.
    setSecondFile(null);
    setSecondMetadata(null);
    setMetadata(null);
    setResult(null);
    setError(null);
    clearPreview();
    setIsInspecting(true);

    try {
      const inspected = await readSourceCreative(nextFile);
      setMetadata(inspected.metadata);
      // Розпізнали формат — фіксуємо його разом із платформами, які його замовляють,
      // щоб після завантаження нічого натискати не треба було.
      const detected = inspected.metadata.detectedFormat;
      setFormatLocked(Boolean(detected));
      if (detected) {
        setOptions((current) => ({
          ...current,
          formatKey: detected,
          targetPlatforms: platformsForFormat(detected, creativeSize(inspected.metadata))
        }));
      }
    } catch (inspectionError) {
      setError(inspectionError instanceof Error ? inspectionError.message : 'Could not inspect uploaded package.');
    } finally {
      setIsInspecting(false);
    }
  }

  // Один zip — звичайна конвертація; два разом — одразу модалка адаптивного пакета.
  async function handleDroppedFiles(files: FileList | null | undefined) {
    const zips = [...(files ?? [])];
    if (zips.length === 0) return;
    if (zips.length === 1) {
      void handleFile(zips[0]);
      return;
    }
    if (zips.length > 2) {
      setError('Drop one zip, or two resizes to combine them into one adaptive package.');
      return;
    }
    setError(null);
    try {
      setCombineSeed(await Promise.all(zips.map(inspectSlot)));
    } catch (inspectionError) {
      setError(inspectionError instanceof Error ? inspectionError.message : 'Could not inspect uploaded packages.');
    }
  }

  function applyCombination(mobile: CombineSlot, wide: CombineSlot, formatKey: FormatKey) {
    setCombineSeed(null);
    setFile(mobile.file);
    setMetadata(mobile.metadata);
    setSecondFile(wide.file);
    setSecondMetadata(wide.metadata);
    setFormatLocked(true);
    setError(null);
    setOptions((current) => ({ ...current, formatKey, targetPlatforms: platformsForFormat(formatKey, creativeSize(mobile.metadata)) }));
    setResult(null);
    clearPreview();
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    void handleDroppedFiles(event.dataTransfer.files);
  }

  function selectFormat(formatKey: FormatKey) {
    // Зміна формату переобирає платформи: у матриці кожен формат замовляє свій набір.
    updateOptions({ ...options, formatKey, targetPlatforms: platformsForFormat(formatKey, sourceSize) });
  }

  function togglePlatform(platform: TargetPlatform) {
    const targetPlatforms = options.targetPlatforms.includes(platform)
      ? options.targetPlatforms.filter((item) => item !== platform)
      : [...options.targetPlatforms, platform];
    updateOptions({ ...options, targetPlatforms });
  }

  async function runConversion() {
    if (!file) {
      setError('Upload a DV360 HTML5 zip before converting.');
      return;
    }
    if (options.targetPlatforms.length === 0) {
      setError('Select at least one output format before converting.');
      return;
    }

    setIsConverting(true);
    setError(null);
    clearPreview();

    try {
      const nextResult = await convertDv360Banner(file, options, activeFormat.secondLayout ? secondFile ?? undefined : undefined);
      setResult(nextResult);
      const generated = nextResult.packages.filter((pkg) => pkg.platform !== 'bundle').length;
      setToast(`Conversion completed — ${generated} platform package${generated === 1 ? '' : 's'} generated`);
      const firstPackage = nextResult.packages.find((pkg): pkg is OutputPackage & { platform: TargetPlatform } => pkg.platform !== 'bundle');
      if (firstPackage) await openPreview(firstPackage);
    } catch (conversionError) {
      setResult(null);
      setError(conversionError instanceof Error ? conversionError.message : 'Conversion failed.');
    } finally {
      setIsConverting(false);
    }
  }

  async function openPreview(output: OutputPackage & { platform: TargetPlatform }) {
    try {
      setPreviewError(null);
      if (preview?.url) URL.revokeObjectURL(preview.url);
      const url = await createPackagePreviewUrl(output);
      setPreview({ packageName: output.fileName, platform: output.platform, url });
    } catch (previewFailure) {
      setPreview(null);
      setPreviewError(previewFailure instanceof Error ? previewFailure.message : 'Preview could not be created.');
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Wrench size={20} />
          <h1>Banner Forge</h1>
          <span className="ready-pill"><span />Ready</span>
        </div>
        <div className="topbar-tools">
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button type="button" onClick={() => setActiveDialog('settings')}><Settings size={15} />Settings</button>
          <button type="button" onClick={() => setActiveDialog('help')}><HelpCircle size={15} />Help</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="column source-column">
          <h2>1. Source</h2>
          <label className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            <input type="file" accept=".zip,application/zip" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => { void handleDroppedFiles(event.target.files); event.target.value = ''; }} />
            <UploadCloud size={32} />
            <strong>Drop DV360 zip here</strong>
            <span>or click to browse</span>
          </label>

          <button
            type="button"
            className="combine-button"
            onClick={() => setCombineSeed(file && metadata && secondFile && secondMetadata ? [{ file, metadata }, { file: secondFile, metadata: secondMetadata }] : [])}
          >
            <Layers size={16} />
            <span>
              <strong>Adaptive package — 2 layouts</strong>
              <small>Mobile + desktop resize in one zip</small>
            </span>
          </button>

          {file && secondFile ? (
            <div className="combined-source">
              <div className="combined-head">
                <Layers size={15} />
                <strong>Adaptive {activeFormat.label}</strong>
                <span className="layout-badge">2 layouts</span>
                <button type="button" onClick={() => metadata && secondMetadata && setCombineSeed([{ file, metadata }, { file: secondFile, metadata: secondMetadata }])}>Edit</button>
              </div>
              <div className="combined-row">
                <Smartphone size={14} />
                <span>{file.name}</span>
                <small>{formatDimensions(metadata)}</small>
              </div>
              <div className="combined-row">
                <Monitor size={14} />
                <span>{secondFile.name}</span>
                <small>{formatDimensions(secondMetadata)}</small>
              </div>
              {!activeFormat.secondLayout && (
                <p className="panel-note warn">{activeFormat.label} packs one layout — the desktop resize is ignored. Switch the format back to use both.</p>
              )}
            </div>
          ) : file && (
            <div className="file-chip">
              <FileText size={18} />
              <span>{file.name}</span>
              <small>{formatBytes(file.size)}</small>
              <CheckCircle2 size={17} />
            </div>
          )}

          <section className="mini-panel metadata-card">
            <h3>Detected Banner Metadata</h3>
            <dl>
              <MetadataRow label="Ad unit size" value={formatDimensions(activeMetadata)} />
              <MetadataRow
                label="Format"
                value={activeMetadata ? (activeMetadata.detectedFormat ? formatSpec(activeMetadata.detectedFormat).label : 'Not recognised') : '-'}
              />
              <MetadataRow label="Size read from" value={activeMetadata?.sizeSource ?? '-'} />
              <MetadataRow label="Environment" value="HTML5" />
              <MetadataRow label="Initial load" value={file ? formatBytes(file.size) : '-'} />
              <MetadataRow label="Total files" value={activeMetadata ? String(activeMetadata.assetCount) : '-'} />
              <MetadataRow label="ClickTag" value={activeMetadata ? (activeMetadata.detectedClickTag ? 'Detected' : 'Not found') : '-'} />
              <MetadataRow label="Entrypoint" value={activeMetadata?.entryPath ?? '-'} />
            </dl>
            <div className={`validation-line ${activeMetadata ? 'valid' : ''}`}>
              {isInspecting ? <Loader2 className="spin" size={17} /> : <CheckCircle2 size={17} />}
              {isInspecting ? 'Inspecting package' : activeMetadata ? 'DV360 package inspected' : 'Waiting for package'}
            </div>
          </section>

          <section className="mini-panel">
            <h3>Landing Page / Click URL</h3>
            <input
              value={options.landingUrl}
              onChange={(event) => updateOptions({ ...options, landingUrl: event.target.value })}
              placeholder="https://example.com"
            />
          </section>

          <section className="mini-panel">
            <h3>Creative Format</h3>
            {formatLocked ? (
              <div className="format-lock">
                <Lock size={15} />
                <div>
                  <strong>{activeFormat.label}</strong>
                  <span>
                    Detected from {activeMetadata?.sizeSource ?? 'the package'}
                    {activeMetadata?.detectedScale === 2 ? ' / 2x source' : ''}
                  </span>
                </div>
                <button type="button" onClick={() => setFormatLocked(false)}>Change</button>
              </div>
            ) : (
              <>
                <FormatSelect value={options.formatKey} onChange={selectFormat} />
                {file && !activeMetadata?.detectedFormat && (
                  <p className="panel-note warn">
                    {sourceSize
                      ? `${sourceSize.width}x${sourceSize.height} is not in the delivery matrix — pick the format to convert to.`
                      : 'No ad.size found in the package — pick the format manually.'}
                  </p>
                )}
              </>
            )}
            <p className="panel-note">Native source: {describeSizes(activeFormat.sizes)}</p>
          </section>

          <section className="mini-panel">
            <h3>Target Platforms</h3>
            {ALL_PLATFORMS.map((platform) => (
              <PresetRow
                key={platform}
                checked={options.targetPlatforms.includes(platform)}
                label={labelPlatform(platform)}
                value={platformNote(platform, options)}
                onChange={() => togglePlatform(platform)}
                onSettings={() => setActiveDialog('settings')}
              />
            ))}
            {sourceSize && options.targetPlatforms.some((platform) => !acceptsSize(platform, options.formatKey, sourceSize)) && (
              <p className="panel-note warn">
                {options.targetPlatforms
                  .filter((platform) => !acceptsSize(platform, options.formatKey, sourceSize))
                  .map((platform) => `${labelPlatform(platform)} expects ${describeSizes(acceptedSizes(platform, options.formatKey))}`)
                  .join('; ')}
                {` — this creative is ${sourceSize.width}x${sourceSize.height}; check the preview.`}
              </p>
            )}
          </section>

          <button className="convert-button" onClick={runConversion} disabled={isConverting || isInspecting || options.targetPlatforms.length === 0}>
            {isConverting ? <Loader2 className="spin" size={20} /> : <Play size={20} />}
            Convert
          </button>
        </aside>

        <section className="column pipeline-column">
          <h2>2. Pipeline</h2>
          <div className={`source-card ${activeMetadata ? 'validated' : ''}`}>
            <div className="source-card-head">Source (DV360)</div>
            <div className="source-card-body">
              <FileCode2 size={26} />
              <div>
                <strong>{file ? (secondFile ? `${file.name} + ${secondFile.name}` : file.name) : 'No source package loaded'}</strong>
                <span>
                  {secondFile
                    ? `${formatDimensions(activeMetadata)} + ${formatDimensions(secondMetadata)} / HTML5 / 2 layouts`
                    : `${formatDimensions(activeMetadata)} / HTML5 / ${activeMetadata?.assetCount ?? 0} files`}
                </span>
              </div>
            </div>
            <div className="source-status">
              {isInspecting ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />}
              {result ? 'Converted' : isInspecting ? 'Inspecting' : activeMetadata ? 'Ready to convert' : file ? 'Inspection needed' : 'Pending'}
            </div>
          </div>

          <div className="pipeline-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>

          <div className="platform-grid">
            <PlatformCard
              title="UMH"
              enabled={options.targetPlatforms.includes('umh')}
              isReady={Boolean(activeMetadata)}
              isConverting={isConverting}
              output={platformPackages.find((pkg) => pkg.platform === 'umh')}
              steps={['Normalize assets', 'Convert click flow', 'Build UMH package', 'Validate']}
            />
            <PlatformCard
              title="Fusify / AdPartner"
              enabled={options.targetPlatforms.includes('fusify')}
              isReady={Boolean(activeMetadata)}
              isConverting={isConverting}
              output={platformPackages.find((pkg) => pkg.platform === 'fusify')}
              steps={['Flatten archive', 'Convert click API', 'Build package', 'Validate']}
            />
            <PlatformCard
              title="Admixer (AdMX)"
              enabled={options.targetPlatforms.includes('admixer')}
              isReady={Boolean(activeMetadata)}
              isConverting={isConverting}
              output={platformPackages.find((pkg) => pkg.platform === 'admixer')}
              steps={['Create body.html', 'Add API bridge', 'Build AdMX package', 'Validate']}
            />
          </div>

          {error && (
            <div className="inline-error">
              <AlertTriangle size={18} />
              {error}
            </div>
          )}

          <section className="validation-summary">
            <div className={`validation-pill ${criticalWarnings.length > 0 ? 'warn' : 'ok'}`}>
              {criticalWarnings.length > 0 ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
              <span>
                {result
                  ? criticalWarnings.length > 0
                    ? `${criticalWarnings.length} warning${criticalWarnings.length === 1 ? '' : 's'}`
                    : `${completedChecks}/${totalChecks} checks passed`
                  : 'No conversion yet'}
              </span>
            </div>
            <button type="button" className="details-link" onClick={() => setActiveDialog('validation')}>
              Details
            </button>
          </section>
        </section>

        <aside className="column results-column">
          <h2>3. Results</h2>
          <section className="results-table">
            <div className="results-head">
              <span>Output</span>
              <span>Status</span>
              <span>Size</span>
              <span>Actions</span>
            </div>
            {platformPackages.length > 0 ? platformPackages.map((pkg) => (
              <OutputRow key={pkg.fileName} output={pkg} onPreview={openPreview} />
            )) : (
              <div className="empty-results">Converted packages will appear here.</div>
            )}
          </section>

          {bundlePackage && (
            <DownloadButton output={bundlePackage} className="bundle-button">
              <Download size={20} />
              {platformPackages.length === 1
                ? 'Download package'
                : `Download bundle (${platformPackages.length} files)`}
            </DownloadButton>
          )}

          <section className="preview-panel">
            <div className="preview-title">
              <h3>Preview ({preview ? labelPlatform(preview.platform) : 'select output'})</h3>
              <select
                value={preview?.packageName ?? ''}
                onChange={(event) => {
                  const pkg = platformPackages.find((item) => item.fileName === event.target.value);
                  if (pkg) void openPreview(pkg);
                }}
              >
                <option value="" disabled>Select package</option>
                {platformPackages.map((pkg) => <option key={pkg.fileName} value={pkg.fileName}>{labelPlatform(pkg.platform)}</option>)}
              </select>
            </div>
            <div className="preview-toolbar">
              <button type="button" onClick={() => preview && window.open(preview.url, '_blank', 'noopener,noreferrer')} disabled={!preview}>
                <ExternalLink size={17} />
              </button>
              <button type="button" onClick={() => preview && platformPackages.find((pkg) => pkg.fileName === preview.packageName) && void openPreview(platformPackages.find((pkg) => pkg.fileName === preview.packageName)!)} disabled={!preview}>
                <RefreshCw size={17} />
              </button>
              <button type="button" className={previewDevice === 'desktop' ? 'active' : ''} onClick={() => setPreviewDevice('desktop')}><Monitor size={17} /></button>
              <button type="button" className={previewDevice === 'mobile' ? 'active' : ''} onClick={() => setPreviewDevice('mobile')}><Smartphone size={17} /></button>
            </div>
            <div className={`preview-canvas ${previewDevice}`}>
              {preview ? (
                <iframe
                  title={`${preview.packageName} preview`}
                  src={preview.url}
                  sandbox="allow-scripts allow-same-origin"
                  style={{
                    width: activeMetadata?.width ? `${activeMetadata.width}px` : '100%',
                    height: activeMetadata?.height ? `${activeMetadata.height}px` : '100%'
                  }}
                />
              ) : (
                <div className="preview-placeholder">
                  <PackageCheck size={42} />
                  {previewError ?? 'Select Preview on an output row after conversion.'}
                </div>
              )}
            </div>
            {previewError && <div className="preview-error">{previewError}</div>}
          </section>
        </aside>
      </section>

      <footer className="footer-note">
        <span>SFP Data Science Team</span>
      </footer>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification">
            <X size={15} />
          </button>
        </div>
      )}

      {combineSeed && (
        <CombineDialog seed={combineSeed} onCancel={() => setCombineSeed(null)} onCombine={applyCombination} />
      )}

      {activeDialog && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setActiveDialog(null)}>
          <section
            className={`dialog ${activeDialog === 'validation' ? 'wide' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={activeDialog === 'settings' ? 'Conversion settings' : activeDialog === 'validation' ? 'Validation & Report' : 'Help'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <h3>{activeDialog === 'settings' ? 'Conversion Settings' : activeDialog === 'validation' ? 'Validation & Report' : 'How to Verify Conversion'}</h3>
              <button type="button" onClick={() => setActiveDialog(null)}>x</button>
            </div>
            {activeDialog === 'validation' ? (
              <div className="dialog-body validation-dialog">
                {criticalWarnings.length > 0 && (
                  <div className="dialog-warnings">
                    {criticalWarnings.map((warning) => (
                      <div className="validation-warning" key={warning}>
                        <AlertTriangle size={16} />
                        <span>{warning}</span>
                      </div>
                    ))}
                  </div>
                )}
                {platformPackages.length === 0 ? (
                  <p>Convert a package to see validation results.</p>
                ) : (
                  platformPackages.map((pkg) => (
                    <div className="validation-group" key={pkg.fileName}>
                      <h4>{labelPlatform(pkg.platform)}</h4>
                      <ul className="check-list">
                        {pkg.validation.map((check) => (
                          <li key={check.label} className={check.passed ? 'pass' : 'fail'}>
                            {check.passed ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                            <span>{check.label}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            ) : activeDialog === 'settings' ? (
              <div className="dialog-body">
                <label className="dialog-check">
                  <input type="checkbox" checked={options.umhAutoButton} onChange={(event) => updateOptions({ ...options, umhAutoButton: event.target.checked })} />
                  UMH auto click layer
                </label>
                <label>
                  Creative format
                  <FormatSelect value={options.formatKey} onChange={selectFormat} />
                </label>
                <p>
                  {activeFormat.label} is ordered by {platformsForFormat(options.formatKey).map(labelPlatform).join(', ')} and expects a{' '}
                  {describeSizes(activeFormat.sizes)} DV360 source.
                </p>
                <p>Changing settings clears generated outputs so stale packages are not reused.</p>
              </div>
            ) : (
              <div className="dialog-body">
                <ol>
                  <li>Check that metadata is filled immediately after upload.</li>
                  <li>Run Convert and confirm every selected platform has Success status.</li>
                  <li>Open Preview for each selected platform package.</li>
                  <li>Open each zip and verify the platform entrypoint plus required API bridge.</li>
                  <li>Before trafficking, upload the zip to the target platform validator.</li>
                </ol>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

interface CombineSlot {
  file: File;
  metadata: CreativeMetadata;
}

async function inspectSlot(file: File): Promise<CombineSlot> {
  return { file, metadata: (await readSourceCreative(file)).metadata };
}

function aspectOf(slot: CombineSlot): number {
  return slot.metadata.width && slot.metadata.height ? slot.metadata.width / slot.metadata.height : 1;
}

/** Вужчий ресайз — мобільний (основний), ширший — десктопний; порожні слоти лишаються на місці. */
function orderSlots(slots: Array<CombineSlot | null>): Array<CombineSlot | null> {
  const [first, second] = slots;
  return first && second && aspectOf(first) > aspectOf(second) ? [second, first] : [first, second];
}

/**
 * Модалка адаптивного пакета: два підписані слоти (мобільний і десктопний ресайз) і
 * пояснення, що саме вийде — який формат, які платформи отримають обидва макети і коли
 * пакет перемикається між ними.
 */
function CombineDialog({ seed, onCancel, onCombine }: { seed: CombineSlot[]; onCancel: () => void; onCombine: (mobile: CombineSlot, wide: CombineSlot, formatKey: FormatKey) => void }) {
  const [slots, setSlots] = useState<Array<CombineSlot | null>>(() => orderSlots([seed[0] ?? null, seed[1] ?? null]));
  const [swapped, setSwapped] = useState(() => Boolean(seed[0] && seed[1] && aspectOf(seed[0]) > aspectOf(seed[1])));
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function fillSlot(index: number, nextFile?: File) {
    if (!nextFile) return;
    setBusySlot(index);
    setSlotError(null);
    try {
      const slot = await inspectSlot(nextFile);
      const next = [...slots];
      next[index] = slot;
      const ordered = orderSlots(next);
      setSwapped(ordered[0] !== next[0]);
      setSlots(ordered);
    } catch (inspectionError) {
      setSlotError(inspectionError instanceof Error ? inspectionError.message : 'Could not read this zip.');
    } finally {
      setBusySlot(null);
    }
  }

  const [mobile, wide] = slots;
  // Формат пакета задає мобільний (основний) ресайз: 492x696 → fullscreen, 800x400 → halfscreen.
  const formatKey = mobile?.metadata.detectedFormat;
  const spec = formatKey ? formatSpec(formatKey) : null;
  const problem = !mobile || !wide
    ? null
    : !spec
      ? `${formatDimensions(mobile.metadata)} is not in the delivery matrix, so the package format is unknown.`
      : !spec.secondLayout
        ? `${spec.label} packs a single layout. Two layouts work for Fullscreen (e.g. 492 x 696 + 800 x 400) and Halfscreen (e.g. 800 x 400 + 1920 x 200).`
        : null;
  const ready = Boolean(mobile && wide && spec?.secondLayout && !problem);

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <section className="dialog combine-dialog" role="dialog" aria-modal="true" aria-label="Adaptive package — 2 layouts" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <h3>Adaptive package — 2 layouts</h3>
          <button type="button" onClick={onCancel} aria-label="Close">x</button>
        </div>
        <div className="dialog-body">
          <p className="combine-intro">
            Two DV360 resizes of the same creative go into <strong>one zip</strong>. On air the banner shows the layout that fits the screen.
          </p>

          <div className="combine-slots">
            {[0, 1].map((index) => {
              const slot = slots[index];
              const isMobile = index === 0;
              return (
                <div key={index} className={`combine-slot ${slot ? 'filled' : ''}`}>
                  <div className="combine-slot-head">
                    {isMobile ? <Smartphone size={16} /> : <Monitor size={16} />}
                    <strong>{isMobile ? 'Mobile layout' : 'Desktop layout'}</strong>
                  </div>
                  {slot ? (
                    <div className="combine-slot-file">
                      <span className="combine-size">{formatDimensions(slot.metadata)}</span>
                      <span className="combine-name" title={slot.file.name}>{slot.file.name}</span>
                      <span className="combine-format">{slot.metadata.detectedFormat ? formatSpec(slot.metadata.detectedFormat).label : 'Not in matrix'} source</span>
                      <button type="button" onClick={() => { const next = [...slots]; next[index] = null; setSlots(next); setSwapped(false); }}>Replace</button>
                    </div>
                  ) : (
                    <label className="combine-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void fillSlot(index, event.dataTransfer.files[0]); }}>
                      <input type="file" accept=".zip,application/zip" onChange={(event: ChangeEvent<HTMLInputElement>) => { void fillSlot(index, event.target.files?.[0]); event.target.value = ''; }} />
                      {busySlot === index ? <Loader2 className="spin" size={20} /> : <UploadCloud size={20} />}
                      <strong>Drop zip</strong>
                      <span>{isMobile ? 'narrower: 492x696 (fullscreen) or 800x400 (halfscreen)' : 'wider: 800x400 (fullscreen) or 1920x200 (halfscreen)'}</span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          {swapped && <p className="panel-note">The narrower resize was moved to Mobile automatically.</p>}
          {slotError && <p className="panel-note warn">{slotError}</p>}
          {problem && <p className="panel-note warn">{problem}</p>}

          {ready && spec && formatKey && mobile && wide && (
            <div className="combine-summary">
              <strong>Result: {spec.label} package</strong>
              <ul>
                <li>{switchRule(formatKey, mobile.metadata, wide.metadata)}</li>
                {ALL_PLATFORMS.map((platform) => (
                  <li key={platform}>
                    <span>{labelPlatform(platform)}</span>
                    {takesSecondLayout(platform, formatKey)
                      ? ` — both layouts in one zip`
                      : ` — ${formatDimensions(mobile.metadata)} only (this platform packs one layout)`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="combine-actions">
            <button type="button" className="secondary-action" onClick={onCancel}>Cancel</button>
            <button type="button" className="convert-button" disabled={!ready} onClick={() => ready && mobile && wide && formatKey && onCombine(mobile, wide, formatKey)}>
              <Layers size={17} />
              Combine
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function switchRule(formatKey: FormatKey, mobile: CreativeMetadata, wide: CreativeMetadata): string {
  if (formatKey === 'fullscreen') {
    return `Portrait screens show ${formatDimensions(mobile)}; landscape phones and desktop show ${formatDimensions(wide)}.`;
  }
  return `Slots narrower than 3:1 (phones) show ${formatDimensions(mobile)}; wide desktop slots show ${formatDimensions(wide)}.`;
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function FormatSelect({ value, onChange }: { value: FormatKey; onChange: (formatKey: FormatKey) => void }) {
  const fixed = FORMAT_MATRIX.filter((spec) => spec.kind === 'fixed');
  const fluid = FORMAT_MATRIX.filter((spec) => spec.kind === 'fluid');
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as FormatKey)} aria-label="Creative format">
      <optgroup label="Fixed sizes">
        {fixed.map((spec) => <option key={spec.key} value={spec.key}>{spec.label}</option>)}
      </optgroup>
      <optgroup label="Fluid placements">
        {fluid.map((spec) => (
          <option key={spec.key} value={spec.key}>{`${spec.label} (${describeSizes(spec.sizes)})`}</option>
        ))}
      </optgroup>
    </select>
  );
}

function PresetRow({ checked, disabled, label, value, onChange, onSettings }: { checked: boolean; disabled?: boolean; label: string; value: string; onChange: () => void; onSettings: () => void }) {
  return (
    <div className={`preset-row ${disabled ? 'unavailable' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />
      <span>{label}</span>
      <small>{value}</small>
      <button type="button" onClick={onSettings} aria-label={`${label} settings`} disabled={disabled}><Settings size={15} /></button>
    </div>
  );
}

function PlatformCard({ title, enabled, isReady, isConverting, output, steps }: { title: string; enabled: boolean; isReady: boolean; isConverting: boolean; output?: OutputPackage; steps: string[] }) {
  const status = output ? 'Completed' : !enabled ? 'Disabled' : isConverting ? 'Converting' : isReady ? 'Ready' : 'Pending';
  return (
    <article className={`platform-card ${output ? 'done' : ''} ${!enabled ? 'disabled' : ''}`}>
      <div className="platform-heading">
        {title.startsWith('Admixer') ? <span className="admx-mark">AD</span> : title.startsWith('Fusify') ? <Hexagon size={22} /> : <PackageCheck size={24} />}
        <strong>{title}</strong>
      </div>
      <span className="planned">{status}</span>
      <ol>
        {steps.map((step, index) => <li key={step} className={output || (isConverting && enabled) || (isReady && enabled && index === 0) ? 'active-step' : ''}>{step}</li>)}
      </ol>
      <div className="platform-output">
        <span>Output</span>
        <strong>{enabled ? output?.fileName ?? 'Will be generated after Convert' : 'Excluded by preset'}</strong>
      </div>
    </article>
  );
}

function OutputRow({ output, onPreview }: { output: OutputPackage & { platform: TargetPlatform }; onPreview: (output: OutputPackage & { platform: TargetPlatform }) => Promise<void> }) {
  const isValid = output.validation.every((check) => check.passed);
  return (
    <div className="output-row">
      <div className="output-name">
        {output.platform === 'admixer' ? <span className="admx-mark small">AD</span> : <PackageCheck size={25} />}
        <div>
          <strong>{labelPlatform(output.platform)}</strong>
          <span>{output.fileName}</span>
        </div>
      </div>
      <div className={`output-status ${isValid ? '' : 'warning'}`}>
        {isValid ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
        <div><strong>{isValid ? 'Success' : 'Review'}</strong><span>{isValid ? 'Checks passed' : 'Needs QA'}</span></div>
      </div>
      <span className="output-size">{formatBytes(output.sizeBytes)}</span>
      <div className="output-actions">
        <DownloadButton output={output} className="icon-button" ariaLabel={`Download ${output.fileName}`}>
          <Download size={18} />
        </DownloadButton>
        <button type="button" className="icon-button" onClick={() => void onPreview(output)} aria-label={`Preview ${output.fileName}`}>
          <ChevronDown size={18} />
        </button>
      </div>
    </div>
  );
}

function DownloadButton({ output, children, className, ariaLabel }: { output: OutputPackage; children: React.ReactNode; className?: string; ariaLabel?: string }) {
  const url = useMemo(() => URL.createObjectURL(output.blob), [output.blob]);
  return (
    <a className={className} href={url} download={output.fileName} aria-label={ariaLabel}>
      {children}
    </a>
  );
}

function formatDimensions(metadata: CreativeMetadata | null): string {
  const size = creativeSize(metadata);
  if (!size) return '-';
  const declared = metadata?.declaredSize;
  // Джерело оголосило інший розмір, ніж той, за яким формат розпізнано — показуємо обидва.
  return declared ? `${size.width} x ${size.height} (source: ${declared.width} x ${declared.height})` : `${size.width} x ${size.height}`;
}

function creativeSize(metadata: CreativeMetadata | null | undefined): Dimensions | undefined {
  return metadata?.width && metadata.height ? { width: metadata.width, height: metadata.height } : undefined;
}

/** Підпис під платформою: що вона отримає для цього формату. Доступні всі платформи. */
function platformNote(platform: TargetPlatform, options: ConversionOptions): string {
  if (platform === 'umh') {
    return options.umhAutoButton ? 'auto click' : 'creative click';
  }
  if (platform === 'fusify') {
    return options.formatKey === 'halfscreen' ? 'body.html + API' : 'flat index.html';
  }
  return 'API 2.0';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function labelPlatform(platform: TargetPlatform): string {
  return platform === 'umh' ? 'UMH' : platform === 'fusify' ? 'Fusify / AdPartner' : 'Admixer (AdMX)';
}
