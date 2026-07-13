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
  Loader2,
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
import { createPackagePreviewUrl } from './lib/preview';
import type { AdmixerMode, ConversionOptions, ConversionResult, CreativeMetadata, FusifyFormat, OutputPackage, TargetPlatform, UmhFormat } from './lib/types';

const initialOptions: ConversionOptions = {
  landingUrl: 'https://www.example.com/summer-sale',
  admixerMode: 'fullscreen',
  umhFormat: 'standard',
  fusifyFormat: 'standard',
  umhAutoButton: true,
  targetPlatforms: ['umh', 'fusify', 'admixer']
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
    setMetadata(null);
    setResult(null);
    setError(null);
    clearPreview();
    setIsInspecting(true);

    try {
      const inspected = await readSourceCreative(nextFile);
      setMetadata(inspected.metadata);
    } catch (inspectionError) {
      setError(inspectionError instanceof Error ? inspectionError.message : 'Could not inspect uploaded package.');
    } finally {
      setIsInspecting(false);
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    void handleFile(event.dataTransfer.files[0]);
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
      const nextResult = await convertDv360Banner(file, options);
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
            <input type="file" accept=".zip,application/zip" onChange={(event: ChangeEvent<HTMLInputElement>) => void handleFile(event.target.files?.[0])} />
            <UploadCloud size={32} />
            <strong>Drop DV360 zip here</strong>
            <span>or click to browse</span>
          </label>

          {file && (
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
            <h3>Format Presets</h3>
            <PresetRow
              checked={options.targetPlatforms.includes('umh')}
              label={`UMH (${options.umhFormat})`}
              value={options.umhAutoButton ? 'auto click' : 'creative click'}
              onChange={() => togglePlatform('umh')}
              onSettings={() => setActiveDialog('settings')}
            />
            <select
              value={options.umhFormat}
              onChange={(event) => updateOptions({ ...options, umhFormat: event.target.value as UmhFormat })}
            >
              <option value="standard">UMH standard banner (ad.size WxH)</option>
              <option value="fullscreen">UMH fullscreen</option>
              <option value="halfscreen">UMH halfscreen</option>
            </select>
            <PresetRow
              checked={options.targetPlatforms.includes('fusify')}
              label={`Fusify / AdPartner (${options.fusifyFormat})`}
              value={options.fusifyFormat === 'halfscreen' ? 'body.html + API' : 'flat index.html'}
              onChange={() => togglePlatform('fusify')}
              onSettings={() => setActiveDialog('settings')}
            />
            <select
              value={options.fusifyFormat}
              onChange={(event) => updateOptions({ ...options, fusifyFormat: event.target.value as FusifyFormat })}
            >
              <option value="standard">AdPartner standard banner (index.html)</option>
              <option value="halfscreen">AdPartner halfscreen (body.html)</option>
            </select>
            <PresetRow
              checked={options.targetPlatforms.includes('admixer')}
              label={`Admixer (${options.admixerMode})`}
              value="API 2.0"
              onChange={() => togglePlatform('admixer')}
              onSettings={() => setActiveDialog('settings')}
            />
            <select
              value={options.admixerMode}
              onChange={(event) => updateOptions({ ...options, admixerMode: event.target.value as AdmixerMode })}
            >
              <option value="fullscreen">Admixer fullscreen</option>
              <option value="halfscreen">Admixer mobile halfscreen</option>
              <option value="catfish">Admixer catfish</option>
            </select>
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
                <strong>{file?.name ?? 'No source package loaded'}</strong>
                <span>{formatDimensions(activeMetadata)} / HTML5 / {activeMetadata?.assetCount ?? 0} files</span>
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
              Download bundle ({platformPackages.length} files)
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
                  UMH format
                  <select value={options.umhFormat} onChange={(event) => updateOptions({ ...options, umhFormat: event.target.value as UmhFormat })}>
                    <option value="standard">Standard banner</option>
                    <option value="fullscreen">Fullscreen</option>
                    <option value="halfscreen">Halfscreen</option>
                  </select>
                </label>
                <label>
                  Fusify / AdPartner format
                  <select value={options.fusifyFormat} onChange={(event) => updateOptions({ ...options, fusifyFormat: event.target.value as FusifyFormat })}>
                    <option value="standard">Standard banner (index.html)</option>
                    <option value="halfscreen">Halfscreen (body.html)</option>
                  </select>
                </label>
                <label>
                  Admixer format
                  <select value={options.admixerMode} onChange={(event) => updateOptions({ ...options, admixerMode: event.target.value as AdmixerMode })}>
                    <option value="fullscreen">Fullscreen</option>
                    <option value="halfscreen">Mobile halfscreen</option>
                    <option value="catfish">CatFish</option>
                  </select>
                </label>
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

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PresetRow({ checked, label, value, onChange, onSettings }: { checked: boolean; label: string; value: string; onChange: () => void; onSettings: () => void }) {
  return (
    <div className="preset-row">
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} />
      <span>{label}</span>
      <small>{value}</small>
      <button type="button" onClick={onSettings} aria-label={`${label} settings`}><Settings size={15} /></button>
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
  if (!metadata?.width || !metadata.height) return '-';
  return `${metadata.width} x ${metadata.height}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function labelPlatform(platform: TargetPlatform): string {
  return platform === 'umh' ? 'UMH' : platform === 'fusify' ? 'Fusify / AdPartner' : 'Admixer (AdMX)';
}
