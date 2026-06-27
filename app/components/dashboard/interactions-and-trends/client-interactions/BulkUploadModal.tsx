'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Upload, Download, AlertTriangle, CheckCircle, AlertCircle, Loader2, FileSpreadsheet } from 'lucide-react';

interface PreviewRow {
  rowNumber: number;
  crn: string | null;
  externalClient: string | null;
  internalClientName: string;
  internalClientDept: string;
  intakeType: string;
  adHocChannel: string | null;
  type: string;
  teamMembers: string[];
  department: string;
  dateStarted: string;
  dateFinished: string | null;
  status: string;
  portfolioLogged: boolean;
  nna: number | null;
  notes: string | null;
}

interface ValidationError { rowNumber: number; field: string; message: string; }
interface ValidationWarning { rowNumber: number; field: string; message: string; }
interface ParseError { rowNumber: number; message: string; }

type UploadState =
  | { stage: 'idle' }
  | { stage: 'uploading' }
  | { stage: 'errors'; parseErrors: ParseError[]; errors: ValidationError[]; warnings: ValidationWarning[]; preview: PreviewRow[]; invalidCount: number; validCount: number }
  | { stage: 'preview'; preview: PreviewRow[]; warnings: ValidationWarning[]; validCount: number }
  | { stage: 'committing' }
  | { stage: 'success'; inserted: number; warnings: ValidationWarning[] };

interface BulkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

function formatNNA(nna: number | null): string {
  if (nna == null) return '—';
  if (nna >= 1e9) return `$${(nna / 1e9).toFixed(1)}B`;
  if (nna >= 1e6) return `$${(nna / 1e6).toFixed(0)}M`;
  return `$${nna.toLocaleString()}`;
}

const BulkUploadModal: React.FC<BulkUploadModalProps> = ({ isOpen, onClose, onImportComplete }) => {
  const [uploadState, setUploadState] = useState<UploadState>({ stage: 'idle' });
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setUploadState({ stage: 'idle' });
      setIsDragging(false);
      setPendingFile(null);
    }
  }, [isOpen]);

  const processFile = useCallback(async (file: File) => {
    setPendingFile(file);
    setUploadState({ stage: 'uploading' });

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/client-interactions/engagements/bulk', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (res.status === 422) {
        setUploadState({
          stage: 'errors',
          parseErrors: data.parseErrors ?? [],
          errors: data.errors ?? [],
          warnings: data.warnings ?? [],
          preview: data.preview ?? [],
          invalidCount: data.invalidCount ?? data.errors?.length ?? 0,
          validCount: data.validCount ?? 0,
        });
        return;
      }

      if (!res.ok) {
        throw new Error(data.error ?? 'Upload failed.');
      }

      setUploadState({
        stage: 'preview',
        preview: data.preview ?? [],
        warnings: data.warnings ?? [],
        validCount: data.validCount ?? 0,
      });
    } catch (e) {
      setUploadState({ stage: 'idle' });
      setPendingFile(null);
      alert(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'csv') {
      alert('Only .xlsx and .csv files are supported.');
      return;
    }
    processFile(file);
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleConfirmImport = useCallback(async () => {
    if (uploadState.stage !== 'preview' || !pendingFile) return;
    setUploadState({ stage: 'committing' });

    const formData = new FormData();
    formData.append('file', pendingFile);

    try {
      const res = await fetch('/api/client-interactions/engagements/bulk?commit=true', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Commit failed.');
      }

      setUploadState({
        stage: 'success',
        inserted: data.inserted ?? 0,
        warnings: data.warnings ?? [],
      });
    } catch (e) {
      setUploadState({ stage: 'idle' });
      setPendingFile(null);
      alert(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [uploadState.stage, pendingFile]);

  const handleDone = useCallback(() => {
    onImportComplete();
    onClose();
  }, [onImportComplete, onClose]);

  const handleReset = useCallback(() => {
    setUploadState({ stage: 'idle' });
    setPendingFile(null);
  }, []);

  const isBusy = uploadState.stage === 'uploading' || uploadState.stage === 'committing';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isBusy ? (uploadState.stage === 'success' ? handleDone : onClose) : undefined}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col bg-zinc-900 border border-zinc-700/50 shadow-2xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white">Bulk Upload Interactions</h2>
            <p className="text-sm text-muted mt-0.5">Import historical projects from an Excel or CSV file</p>
          </div>
          {!isBusy && (
            <button
              onClick={uploadState.stage === 'success' ? handleDone : onClose}
              className="p-1.5 text-muted hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          {/* ── Idle / Drop zone ── */}
          {uploadState.stage === 'idle' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">
                  Download the template, fill it in with your historical data, then upload it here.
                </p>
                <a
                  href="/api/client-interactions/engagements/template"
                  download
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-zinc-800 border border-zinc-700/50 text-sm text-muted hover:text-white hover:border-zinc-500 transition-colors ml-4"
                >
                  <Download className="w-4 h-4" />
                  Download Template
                </a>
              </div>

              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg py-14 cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-cyan-500/60 bg-cyan-500/5'
                    : 'border-zinc-700 hover:border-zinc-500 bg-zinc-800/30'
                }`}
              >
                <FileSpreadsheet className="w-10 h-10 text-muted" />
                <div className="text-center">
                  <p className="text-sm text-muted">
                    Drop your file here or <span className="text-cyan-400">click to browse</span>
                  </p>
                  <p className="text-xs text-muted mt-1">Supports .xlsx and .csv</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Uploading / Committing ── */}
          {(uploadState.stage === 'uploading' || uploadState.stage === 'committing') && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              <p className="text-muted text-sm">
                {uploadState.stage === 'uploading'
                  ? 'Parsing and validating your file...'
                  : 'Importing rows into the database...'}
              </p>
            </div>
          )}

          {/* ── Errors ── */}
          {uploadState.stage === 'errors' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-300">
                    {uploadState.invalidCount} row{uploadState.invalidCount !== 1 ? 's have' : ' has'} errors
                    {uploadState.validCount > 0 && ` — ${uploadState.validCount} other row${uploadState.validCount !== 1 ? 's are' : ' is'} valid`}
                  </p>
                  <p className="text-xs text-muted mt-1">Fix the issues below in your Excel file and re-upload.</p>
                </div>
              </div>

              <div className="border border-zinc-700/50 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-800/60">
                      <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-4 py-2.5 w-16">Row</th>
                      <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-4 py-2.5 w-40">Field</th>
                      <th className="text-left text-xs font-medium text-muted uppercase tracking-wider px-4 py-2.5">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadState.errors.map((err, i) => (
                      <tr key={i} className="border-t border-zinc-800/50">
                        <td className="px-4 py-2.5 text-muted font-mono text-xs">{err.rowNumber}</td>
                        <td className="px-4 py-2.5 text-muted text-xs">{err.field}</td>
                        <td className="px-4 py-2.5 text-red-300 text-xs">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Preview ── */}
          {uploadState.stage === 'preview' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-emerald-300">
                    {uploadState.validCount} row{uploadState.validCount !== 1 ? 's' : ''} ready to import
                  </p>
                  <p className="text-xs text-muted mt-1">Review below, then click Confirm Import to save to the database.</p>
                </div>
              </div>

              {uploadState.warnings.length > 0 && (
                <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-yellow-300 mb-1">Warnings (rows will still be imported)</p>
                    <ul className="space-y-0.5">
                      {uploadState.warnings.map((w, i) => (
                        <li key={i} className="text-xs text-muted">Row {w.rowNumber} · {w.field}: {w.message}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div className="border border-zinc-700/50 rounded-lg overflow-auto max-h-96">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead className="sticky top-0">
                    <tr className="bg-zinc-800">
                      {['#', 'CRN', 'External Client', 'Internal Client', 'Dept', 'Intake', 'Type', 'Date Started', 'Date Finished', 'Status', 'NNA'].map(h => (
                        <th key={h} className="text-left font-medium text-muted uppercase tracking-wider px-3 py-2.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {uploadState.preview.map((row, i) => (
                      <tr key={i} className={`border-t border-zinc-800/50 ${i % 2 !== 0 ? 'bg-zinc-800/20' : ''}`}>
                        <td className="px-3 py-2 text-muted font-mono">{row.rowNumber}</td>
                        <td className="px-3 py-2 text-cyan-400 font-mono">{row.crn ?? <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-2 text-muted">{row.externalClient ?? <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-2 text-muted">{row.internalClientName}</td>
                        <td className="px-3 py-2 text-muted">{row.internalClientDept}</td>
                        <td className="px-3 py-2 text-muted">
                          {row.intakeType}{row.adHocChannel ? ` · ${row.adHocChannel}` : ''}
                        </td>
                        <td className="px-3 py-2 text-muted">{row.type}</td>
                        <td className="px-3 py-2 text-muted font-mono">{row.dateStarted}</td>
                        <td className="px-3 py-2 text-muted font-mono">{row.dateFinished ?? <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            row.status === 'Completed' ? 'bg-emerald-500/15 text-emerald-400' :
                            row.status === 'In Progress' ? 'bg-blue-500/15 text-blue-400' :

                            row.status === 'Awaiting Meeting' ? 'bg-amber-500/15 text-amber-400' :
                            row.status === 'Follow Up' ? 'bg-orange-500/15 text-orange-400' :
                            'bg-zinc-700/50 text-muted'
                          }`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted">{formatNNA(row.nna)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Success ── */}
          {uploadState.stage === 'success' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-400" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-white">
                  {uploadState.inserted} row{uploadState.inserted !== 1 ? 's' : ''} imported
                </p>
                <p className="text-sm text-muted mt-1">The interactions table has been updated.</p>
              </div>
              {uploadState.warnings.length > 0 && (
                <div className="w-full max-w-md p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <p className="text-xs font-medium text-yellow-300 mb-1">Notes from import</p>
                  <ul className="space-y-0.5">
                    {uploadState.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-muted">Row {w.rowNumber}: {w.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(uploadState.stage === 'preview' || uploadState.stage === 'success' || uploadState.stage === 'errors') && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800/50 flex-shrink-0">
            {uploadState.stage === 'preview' && (
              <>
                <button
                  onClick={handleReset}
                  className="px-4 py-2 text-sm text-muted hover:text-white transition-colors"
                >
                  Upload a different file
                </button>
                <button
                  onClick={handleConfirmImport}
                  className="flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-sm font-medium hover:from-blue-500 hover:to-cyan-400 transition-all rounded-[4px]"
                >
                  <Upload className="w-4 h-4" />
                  Confirm Import ({uploadState.validCount} rows)
                </button>
              </>
            )}
            {uploadState.stage === 'success' && (
              <>
                <div />
                <button
                  onClick={handleDone}
                  className="px-5 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-sm font-medium hover:from-blue-500 hover:to-cyan-400 transition-all rounded-[4px]"
                >
                  Done
                </button>
              </>
            )}
            {uploadState.stage === 'errors' && (
              <>
                <div />
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 px-4 py-2 bg-zinc-800 border border-zinc-700/50 text-sm text-muted hover:text-white transition-colors rounded-[4px]"
                >
                  <Upload className="w-4 h-4" />
                  Try again
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BulkUploadModal;
