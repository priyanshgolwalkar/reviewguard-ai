import React, { useState } from 'react';
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { analyzeBatchOnServer, uploadCsvForParsing } from '../services/apiService.ts';
import { createReviewsBatch, saveReviewAiAnalysis } from '../services/firestoreService.ts';
import type { BusinessRecord, CsvParseResult } from '../shared/validation.ts';

interface CsvImportModalProps {
  business: BusinessRecord;
  onClose: () => void;
  onImported: (count: number) => void;
}

const SAMPLE_CSV = `author,rating,date,source,text
Maya Chen,5,2026-11-18,google,"Fantastic espresso and warm staff. We were seated within 5 minutes even during the morning rush."
Devon Brooks,2,2026-11-17,yelp,"Food was lukewarm after waiting 45 minutes for our entrees. Server apologized, but the kitchen delay ruined dinner."
Elena Morales,1,2026-11-16,google,"Found a charge discrepancy on our receipt and the restroom needed cleaning. Requesting a manager follow-up."
Liam Patel,4,2026-11-15,tripadvisor,"Great ambiance and generous portions. Parking is tight on weekends, so arrive early."`;

export function CsvImportModal({ business, onClose, onImported }: CsvImportModalProps) {
  const { user, getIdToken } = useAuth();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [runAiAfterImport, setRunAiAfterImport] = useState(false);
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null);
  const [error, setError] = useState('');

  function handleDownloadTemplate() {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'reviewguard-sample-reviews.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleParseFile(file: File) {
    setSelectedFile(file);
    setParseResult(null);
    setError('');
    setParsing(true);
    try {
      const token = await getIdToken();
      const result = await uploadCsvForParsing(file, business.id, token);
      setParseResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV file.');
    } finally {
      setParsing(false);
    }
  }

  const validRows = Array.isArray(parseResult?.validRows) ? parseResult.validRows : [];
  const rowErrors = Array.isArray(parseResult?.errors) ? parseResult.errors : [];
  const totalRows =
    typeof parseResult?.totalRows === 'number'
      ? parseResult.totalRows
      : validRows.length + rowErrors.length;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      await handleParseFile(file);
    }
  }

  async function handleConfirmImport() {
    if (!user || validRows.length === 0) return;
    setError('');
    setImporting(true);
    try {
      const createdIds = await createReviewsBatch(
        business.ownerId,
        business.id,
        validRows.map((row) => ({
          authorName: row.authorName,
          rating: row.rating,
          text: row.text,
          reviewDate: row.reviewDate,
          source: row.source,
        }))
      );

      if (runAiAfterImport && createdIds.length > 0) {
        try {
          const token = await getIdToken();
          const batchInputs = createdIds.slice(0, 20).map((reviewId, idx) => ({
            reviewId,
            ...validRows[idx],
          }));
          const aiRes = await analyzeBatchOnServer(
            {
              businessId: business.id,
              business: {
                name: business.name,
                category: business.category,
                city: business.city,
                address: business.address,
                description: business.description,
              },
              reviews: batchInputs,
            },
            token
          );

          await Promise.all(
            (Array.isArray(aiRes?.results) ? aiRes.results : []).map(async (item) => {
              if (item.ok && item.result) {
                await saveReviewAiAnalysis(
                  business.id,
                  item.reviewId,
                  item.result,
                  'unanswered'
                );
              }
            })
          );
        } catch (aiErr) {
          console.warn('Reviews saved to Firestore, but batch AI analysis did not complete:', aiErr);
        }
      }

      onImported(createdIds.length);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to import reviews into Firestore.'
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-import-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 id="csv-import-title" className="font-display text-lg font-semibold text-slate-900">
              Import Reviews via CSV
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Processed strictly in server memory. Original files are never stored.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <div className="text-xs text-slate-600">
              Required columns: <span className="font-mono-num font-medium text-slate-900">rating</span> (1–5) and{' '}
              <span className="font-mono-num font-medium text-slate-900">text</span>. Optional: author, date, source.
            </div>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
            >
              <Download size={14} />
              <span>Download sample CSV</span>
            </button>
          </div>

          <label className="block border border-dashed border-slate-300 hover:border-teal-600 rounded-xl p-6 text-center cursor-pointer transition-colors">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="flex flex-col items-center">
              <FileSpreadsheet size={28} className="text-slate-400" />
              <p className="mt-2 text-sm font-medium text-slate-900">
                {selectedFile ? selectedFile.name : 'Choose a CSV file to parse'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Up to 500 reviews per file · Max 2 MB
              </p>
            </div>
          </label>

          {parsing && (
            <p className="text-xs text-slate-600 text-center">
              Validating columns and review rows in memory...
            </p>
          )}

          {error && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          {parseResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 border border-slate-200 rounded-lg p-3.5 bg-slate-50 text-xs">
                <div>
                  <span className="text-slate-500">Total Rows</span>
                  <p className="font-mono-num text-base font-semibold text-slate-900 mt-0.5">
                    {totalRows}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Valid Ready</span>
                  <p className="font-mono-num text-base font-semibold text-emerald-700 mt-0.5">
                    {validRows.length}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Skipped Errors</span>
                  <p className="font-mono-num text-base font-semibold text-red-700 mt-0.5">
                    {rowErrors.length}
                  </p>
                </div>
              </div>

              {rowErrors.length > 0 && (
                <div className="border border-red-200 bg-red-50 rounded-lg p-3 max-h-32 overflow-y-auto space-y-1">
                  <p className="text-xs font-medium text-red-800">Row Validation Warnings</p>
                  {rowErrors.map((errItem) => (
                    <p key={errItem.rowNumber} className="text-xs text-red-700 font-mono-num">
                      Row {errItem.rowNumber}: {errItem.message}
                    </p>
                  ))}
                </div>
              )}

              {validRows.length > 0 && (
                <>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
                      {validRows.slice(0, 8).map((row) => (
                        <div key={row.rowNumber} className="p-3 text-xs flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-slate-500">
                              <span className="font-medium text-slate-900">{row.authorName}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono-num">{row.rating}/5</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono-num">{row.reviewDate}</span>
                            </div>
                            <p className="mt-1 text-slate-700 line-clamp-1">{row.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={runAiAfterImport}
                      onChange={(e) => setRunAiAfterImport(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                    />
                    <span className="text-xs text-slate-600 leading-relaxed">
                      Automatically run Gemini AI analysis & response drafting on up to 20 imported reviews right away
                    </span>
                  </label>
                </>
              )}
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={importing || parsing || validRows.length === 0}
              onClick={handleConfirmImport}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50"
            >
              <Upload size={15} />
              <span>
                {importing
                  ? 'Importing to Firestore...'
                  : `Import ${validRows.length} Reviews`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
