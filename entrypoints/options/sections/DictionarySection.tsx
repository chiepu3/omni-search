import { useState, useEffect, useRef } from 'react';
import { storage } from '@/lib/storage';
import type { Dictionary, ColumnMapping } from '@/types';
import { createDictionary, parseCsv, detectFormatChange } from '@/lib/dictionary';

export function DictionarySection() {
  const [dicts, setDicts] = useState<Dictionary[]>([]);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    storage.getDictionaries().then(setDicts);
  }, []);

  const save = async (updated: Dictionary[]) => {
    setDicts(updated);
    await storage.saveDictionaries(updated);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this dictionary?')) return;
    await save(dicts.filter(d => d.id !== id));
  };

  const handleImported = async (dict: Dictionary) => {
    const existing = dicts.find(d => d.id === dict.id);
    const next = existing
      ? dicts.map(d => d.id === dict.id ? dict : d)
      : [...dicts, dict];
    await save(next);
    setShowImport(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">
          Import CSV dictionaries to search terminology inline.
        </p>
        <button
          onClick={() => setShowImport(true)}
          className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded"
        >
          + Import CSV
        </button>
      </div>

      {dicts.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-8">No dictionaries imported.</p>
      )}

      <div className="space-y-2">
        {dicts.map(dict => (
          <div key={dict.id} className="flex items-center gap-3 bg-white/5 rounded-lg px-4 py-3">
            <span
              className="w-8 h-8 rounded flex items-center justify-center font-bold text-sm flex-shrink-0"
              style={{ backgroundColor: dict.themeColor }}
            >
              {dict.name.charAt(0).toUpperCase()}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{dict.name}</div>
              <div className="text-xs text-gray-400">
                {dict.entries.length.toLocaleString()} entries · Updated {new Date(dict.updatedAt).toLocaleDateString()}
              </div>
            </div>
            <button
              onClick={() => handleDelete(dict.id)}
              className="text-xs text-red-400 hover:text-red-300 px-2"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {showImport && (
        <CsvImporter
          existingDicts={dicts}
          onImport={handleImported}
          onCancel={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

function CsvImporter({
  existingDicts,
  onImport,
  onCancel,
}: {
  existingDicts: Dictionary[];
  onImport: (dict: Dictionary) => void;
  onCancel: () => void;
}) {
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<string[][]>([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#7c3aed');
  const [mapping, setMapping] = useState<ColumnMapping>({ termColumn: 0 });
  const [headerRow, setHeaderRow] = useState(true);
  const [formatWarning, setFormatWarning] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const text = await file.text();
    setCsvText(text);
    const rows = parseCsv(text);
    setPreview(rows.slice(0, 5));
    if (!name) setName(file.name.replace(/\.csv$/i, ''));
  };

  const handleImport = () => {
    const dataRows = headerRow ? parseCsv(csvText).slice(1) : parseCsv(csvText);
    const dict = createDictionary(name, color, '', mapping);
    // reuse createDictionary but with already-parsed rows
    const finalDict: Dictionary = {
      ...dict,
      entries: dataRows.map((row, i) => ({
        id: `${dict.id}-${i}`,
        term: row[mapping.termColumn]?.trim() ?? '',
        reading: mapping.readingColumn !== undefined ? row[mapping.readingColumn]?.trim() : undefined,
        description: mapping.descriptionColumn !== undefined
          ? row[mapping.descriptionColumn]?.replace(/<[^>]*>/g, '').trim()
          : undefined,
        tags: mapping.tagColumn !== undefined
          ? row[mapping.tagColumn]?.split(/[,;|]/).map(t => t.trim()).filter(Boolean)
          : undefined,
      })).filter(e => e.term !== ''),
    };
    onImport(finalDict);
  };

  const dataRows = preview.slice(headerRow ? 1 : 0);
  const colCount = preview[0]?.length ?? 0;
  const headers = headerRow && preview[0] ? preview[0] : Array.from({ length: colCount }, (_, i) => `Col ${i + 1}`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 rounded-xl shadow-2xl p-6 w-full max-w-2xl space-y-4 border border-white/10 max-h-[90vh] overflow-y-auto">
        <h3 className="font-semibold text-lg">Import Dictionary CSV</h3>

        {/* file picker */}
        <div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <button
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded text-sm"
          >
            Choose CSV file
          </button>
          {csvText && <span className="ml-3 text-sm text-green-400">Loaded ✓</span>}
        </div>

        {csvText && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Dictionary name">
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  className={inputCls} />
              </Field>
              <Field label="Theme color">
                <div className="flex items-center gap-2">
                  <input type="color" value={color} onChange={e => setColor(e.target.value)}
                    className="h-9 w-12 rounded cursor-pointer bg-transparent" />
                  <span className="text-sm text-gray-400">{color}</span>
                </div>
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" checked={headerRow} onChange={e => setHeaderRow(e.target.checked)}
                className="rounded" />
              First row is header
            </label>

            {/* column mapping */}
            <div>
              <p className="text-xs text-gray-400 mb-2">Column assignment</p>
              <div className="grid grid-cols-2 gap-2">
                {(['termColumn', 'readingColumn', 'descriptionColumn', 'tagColumn'] as const).map(field => (
                  <Field key={field} label={field.replace('Column', '') + (field === 'termColumn' ? ' *' : ' (opt)')}>
                    <select
                      value={mapping[field] ?? ''}
                      onChange={e => {
                        const val = e.target.value;
                        setMapping(m => ({
                          ...m,
                          [field]: val === '' ? undefined : Number(val),
                        }));
                      }}
                      className={`${inputCls} cursor-pointer`}
                    >
                      {field !== 'termColumn' && <option value="">— none —</option>}
                      {headers.map((h, i) => (
                        <option key={i} value={i}>{h || `Col ${i + 1}`}</option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
            </div>

            {/* preview table */}
            {dataRows.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Preview (first rows)</p>
                <div className="overflow-x-auto rounded border border-white/10">
                  <table className="text-xs w-full">
                    <thead>
                      <tr className="bg-white/5">
                        {headers.map((h, i) => (
                          <th key={i} className="px-2 py-1 text-left text-gray-400 font-normal border-r border-white/10 last:border-0">
                            {h || `Col ${i + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dataRows.map((row, ri) => (
                        <tr key={ri} className="border-t border-white/5">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-2 py-1 border-r border-white/10 last:border-0 max-w-xs truncate text-gray-300">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {formatWarning && (
              <p className="text-yellow-400 text-sm">{formatWarning}</p>
            )}
          </>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded bg-white/10 hover:bg-white/20 text-gray-300">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!csvText || !name || mapping.termColumn === undefined}
            className="px-4 py-1.5 text-sm rounded bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full bg-white/10 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-violet-500';
