import { useState, useEffect, useRef } from 'react';
import { storage } from '@/lib/storage';
import type { Dictionary, ColumnMapping } from '@/types';
import { createDictionary, parseCsv, detectFormatChange } from '@/lib/dictionary';
import { IconAdd, IconDelete, IconImport } from '@/components/icons';

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
    if (!confirm('この辞書を削除しますか？')) return;
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
          CSVファイルから辞書をインポートして、インライン検索できます。
        </p>
        <button
          onClick={() => setShowImport(true)}
          style={accentBtnStyle}
        >
          <IconImport size={16} />
          CSVをインポート
        </button>
      </div>

      {dicts.length === 0 && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', padding: '32px 0' }}>
          辞書が登録されていません。
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {dicts.map(dict => (
          <div key={dict.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--surface)', borderRadius: '8px', padding: '12px 16px' }}>
            <span
              style={{ width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', flexShrink: 0, backgroundColor: dict.themeColor }}
            >
              {dict.name.charAt(0).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: '13px' }}>{dict.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {dict.entries.length.toLocaleString()} 件 ・ 更新日: {new Date(dict.updatedAt).toLocaleDateString()}
              </div>
            </div>
            <button
              onClick={() => handleDelete(dict.id)}
              style={{ ...actionBtnStyle, color: 'var(--danger)' }}
            >
              <IconDelete size={14} />
              削除
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

  const columnLabels: Record<string, { label: string; required: string }> = {
    termColumn: { label: '用語', required: '必須' },
    readingColumn: { label: '読み', required: '任意' },
    descriptionColumn: { label: '説明', required: '任意' },
    tagColumn: { label: 'タグ', required: '任意' },
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', padding: '24px', width: '100%', maxWidth: '672px', display: 'flex', flexDirection: 'column', gap: '16px', border: '1px solid var(--border)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontWeight: 600, fontSize: '16px', margin: 0 }}>辞書のインポート</h3>

        {/* file picker */}
        <div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <button
            onClick={() => fileRef.current?.click()}
            style={cancelBtnStyle}
          >
            CSVファイルを選択
          </button>
          {csvText && <span style={{ marginLeft: '12px', fontSize: '13px', color: 'var(--success)' }}>読み込み完了</span>}
        </div>

        {csvText && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Field label="辞書名">
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  style={inputCls} />
              </Field>
              <Field label="テーマカラー">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="color" value={color} onChange={e => setColor(e.target.value)}
                    style={{ height: '36px', width: '48px', borderRadius: '6px', cursor: 'pointer', backgroundColor: 'transparent', border: 'none' }} />
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{color}</span>
                </div>
              </Field>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={headerRow} onChange={e => setHeaderRow(e.target.checked)}
                style={{ accentColor: 'var(--accent)' }} />
              1行目をヘッダーとして扱う
            </label>

            {/* column mapping */}
            <div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>列の割り当て</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {(['termColumn', 'readingColumn', 'descriptionColumn', 'tagColumn'] as const).map(field => {
                  const meta = columnLabels[field];
                  return (
                    <Field key={field} label={`${meta.label} (${meta.required})`}>
                      <select
                        value={mapping[field] ?? ''}
                        onChange={e => {
                          const val = e.target.value;
                          setMapping(m => ({
                            ...m,
                            [field]: val === '' ? undefined : Number(val),
                          }));
                        }}
                        style={{ ...inputCls, cursor: 'pointer' }}
                      >
                        {field !== 'termColumn' && <option value="">— なし —</option>}
                        {headers.map((h, i) => (
                          <option key={i} value={i}>{h || `Col ${i + 1}`}</option>
                        ))}
                      </select>
                    </Field>
                  );
                })}
              </div>
            </div>

            {/* preview table */}
            {dataRows.length > 0 && (
              <div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>プレビュー（先頭行）</p>
                <div style={{ overflowX: 'auto', borderRadius: '6px', border: '1px solid var(--border)' }}>
                  <table style={{ fontSize: '12px', width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--surface-hover)' }}>
                        {headers.map((h, i) => (
                          <th key={i} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 400, borderRight: i < headers.length - 1 ? '1px solid var(--border)' : 'none' }}>
                            {h || `Col ${i + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dataRows.map((row, ri) => (
                        <tr key={ri} style={{ borderTop: '1px solid var(--border)' }}>
                          {row.map((cell, ci) => (
                            <td key={ci} style={{ padding: '4px 8px', borderRight: ci < row.length - 1 ? '1px solid var(--border)' : 'none', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
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
              <p style={{ color: '#eab308', fontSize: '13px' }}>{formatWarning}</p>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '8px' }}>
          <button onClick={onCancel}
            style={cancelBtnStyle}>
            キャンセル
          </button>
          <button
            onClick={handleImport}
            disabled={!csvText || !name || mapping.termColumn === undefined}
            style={{ ...accentBtnStyle, opacity: (!csvText || !name || mapping.termColumn === undefined) ? 0.4 : 1 }}
          >
            インポート
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{label}</label>
      {children}
    </div>
  );
}

const accentBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px',
  padding: '6px 12px', borderRadius: '6px', fontSize: '13px',
  backgroundColor: 'var(--accent)', border: 'none',
  color: '#fff', cursor: 'pointer',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 16px', fontSize: '13px', borderRadius: '6px',
  backgroundColor: 'var(--surface-hover)', border: '1px solid var(--border)',
  color: 'var(--text-secondary)', cursor: 'pointer',
};

const actionBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px',
  fontSize: '12px', color: 'var(--text-secondary)',
  background: 'none', border: 'none', cursor: 'pointer',
  padding: '4px 8px',
};

const inputCls: React.CSSProperties = {
  width: '100%', backgroundColor: 'var(--surface-hover)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px',
  fontSize: '13px', outline: 'none',
};
