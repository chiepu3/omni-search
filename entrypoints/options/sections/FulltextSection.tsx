import { useState, useEffect, useRef, useCallback } from 'react';
import { storage, DEFAULT_SETTINGS } from '@/lib/storage';
import { ftRequest, uploadImportFile } from '@/lib/fulltext/client';
import type { ExcludeRule, FulltextStats } from '@/lib/fulltext/protocol';
import type { Settings, SiteConfig } from '@/types';
import { formatDate } from '@/components/relativeTime';
import { IconAdd, IconDelete, IconImport } from '@/components/icons';

type ImportState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'running' | 'done'; done: number; total: number | null; imported: number; skipped: number }
  | { phase: 'error'; error: string };

type StatsState =
  | { status: 'loading' }
  | { status: 'ready'; stats: FulltextStats }
  | { status: 'error'; error: string };

const LEVEL_LABELS: Record<ExcludeRule['level'], string> = {
  no_index: '保存しない',
  url_only: 'URLとタイトルのみ',
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatMB(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb).toLocaleString()} MB`;
}

// 「example.com」「https://example.com/path」のどちらからでもホスト名を取り出す
function parseHost(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  let host = v;
  try {
    if (v.includes('://')) host = new URL(v).host;
    else host = v.split('/')[0];
  } catch {
    return null;
  }
  host = host.toLowerCase();
  return /^[a-z0-9.-]+(:\d+)?$/.test(host) ? host : null;
}

export function FulltextSection() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [sites, setSites] = useState<SiteConfig[]>([]);
  const [bookmarkShortcuts, setBookmarkShortcuts] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<StatsState>({ status: 'loading' });
  const [rules, setRules] = useState<ExcludeRule[] | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [newPattern, setNewPattern] = useState('');
  const [newLevel, setNewLevel] = useState<ExcludeRule['level']>('no_index');
  const [importState, setImportState] = useState<ImportState>({ phase: 'idle' });
  const [domainInput, setDomainInput] = useState('');
  const [deleteMessage, setDeleteMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const s = await ftRequest({ action: 'FT_STATS' });
      if (!s) throw new Error('応答がありません');
      setStats({ status: 'ready', stats: s });
    } catch (err) {
      setStats({ status: 'error', error: errorMessage(err) });
    }
  }, []);

  const loadRules = useCallback(async () => {
    try {
      const list = await ftRequest({ action: 'FT_LIST_RULES' });
      setRules(list ?? []);
      setRulesError(null);
    } catch (err) {
      setRulesError(errorMessage(err));
    }
  }, []);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pollImport = useCallback(async () => {
    try {
      const st = await ftRequest({ action: 'FT_IMPORT_STATUS' });
      if (!st) throw new Error('応答がありません');
      if (st.error) {
        stopPolling();
        setImportState({ phase: 'error', error: st.error });
        return;
      }
      const progress = { done: st.done, total: st.total, imported: st.imported, skipped: st.skipped };
      if (st.running) {
        setImportState({ phase: 'running', ...progress });
      } else {
        stopPolling();
        setImportState({ phase: 'done', ...progress });
        loadStats();
      }
    } catch (err) {
      stopPolling();
      setImportState({ phase: 'error', error: errorMessage(err) });
    }
  }, [loadStats]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = window.setInterval(pollImport, 1000);
  }, [pollImport]);

  useEffect(() => {
    storage.getSettings().then(setSettings);
    storage.getSites().then(setSites);
    storage.getBookmarkShortcuts().then(setBookmarkShortcuts);
    loadStats();
    loadRules();
    // 設定画面を開き直したときに取り込み中なら進捗表示を再開する
    ftRequest({ action: 'FT_IMPORT_STATUS' })
      .then(st => {
        if (st?.running) {
          setImportState({ phase: 'running', done: st.done, total: st.total, imported: st.imported, skipped: st.skipped });
          startPolling();
        }
      })
      .catch((err: unknown) => console.warn('[OmniSearch] 取り込み状況を取得できません', err));
    return stopPolling;
  }, [loadStats, loadRules, startPolling]);

  const save = async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await storage.saveSettings(next);
  };

  // プレフィックスの衝突チェック
  const prefix = settings.fulltextShortcut;
  const prefixWarning = (() => {
    const v = prefix.trim().toLowerCase();
    if (!prefix) return '空欄の間は全文検索モードを使えません。';
    if (/\s/.test(prefix)) return '空白は使えません。';
    const hits: string[] = [];
    if (v === settings.historyShortcut.toLowerCase()) hits.push('履歴検索プレフィックス');
    if (v === settings.dictShortcut.toLowerCase()) hits.push('辞書検索プレフィックス');
    sites.filter(s => s.shortcut.toLowerCase() === v).forEach(s => hits.push(`サイト「${s.name}」`));
    if (Object.values(bookmarkShortcuts).some(sc => sc.toLowerCase() === v)) hits.push('ブックマークのショートカット');
    return hits.length ? `${hits.join('・')}と重複しています。` : null;
  })();

  const handleAddRule = async () => {
    const pattern = newPattern.trim();
    if (!pattern) return;
    try {
      const res = await ftRequest({ action: 'FT_ADD_RULE', pattern, level: newLevel });
      if (!res?.ok) {
        setRulesError(res?.error ?? 'ルールを追加できませんでした');
        return;
      }
      setNewPattern('');
      await loadRules();
    } catch (err) {
      setRulesError(errorMessage(err));
    }
  };

  const handleRemoveRule = async (rule: ExcludeRule) => {
    try {
      const res = await ftRequest({ action: 'FT_REMOVE_RULE', id: rule.id });
      if (!res?.ok) {
        setRulesError(res?.error ?? 'ルールを削除できませんでした');
        return;
      }
      await loadRules();
    } catch (err) {
      setRulesError(errorMessage(err));
    }
  };

  const handleImportFile = async (file: File) => {
    setImportState({ phase: 'uploading' });
    let name: string | undefined;
    let started = false;
    try {
      name = await uploadImportFile(file);
      const res = await ftRequest({ action: 'FT_IMPORT_FTTF', fileHandleId: name });
      if (!res?.ok) throw new Error(res?.error ?? '取り込みを開始できませんでした');
      started = true;
      setImportState({ phase: 'running', done: 0, total: null, imported: 0, skipped: 0 });
      startPolling();
    } catch (err) {
      setImportState({ phase: 'error', error: errorMessage(err) });
    } finally {
      if (name && !started) {
        try {
          const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('ft-import');
          await dir.removeEntry(name);
        } catch { /* Workerが削除済みの場合もある。 */ }
      }
    }
  };

  const deletePages = async (patterns: string[], doneText: (n: number) => string) => {
    setDeleting(true);
    setDeleteMessage(null);
    try {
      let total = 0;
      for (const urlPattern of patterns) {
        const res = await ftRequest({ action: 'FT_DELETE_PAGES', urlPattern });
        total += res?.deleted ?? 0;
      }
      setDeleteMessage({ ok: true, text: doneText(total) });
      loadStats();
    } catch (err) {
      setDeleteMessage({ ok: false, text: `削除できませんでした：${errorMessage(err)}` });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteDomain = () => {
    const host = parseHost(domainInput);
    if (!host) {
      setDeleteMessage({ ok: false, text: 'ドメインの形式が正しくありません（例: example.com）' });
      return;
    }
    if (!confirm(`${host} の保存済みページを削除しますか？`)) return;
    deletePages([`https://${host}/%`, `http://${host}/%`], n => `${host} のページを ${n.toLocaleString()} 件削除しました`)
      .then(() => setDomainInput(''));
  };

  const handleDeleteAll = () => {
    if (!confirm('保存済みページをすべて削除します。この操作は取り消せません。よろしいですか？')) return;
    deletePages(['%'], n => `${n.toLocaleString()} 件のページを削除しました`);
  };

  const importBusy = importState.phase === 'uploading' || importState.phase === 'running';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
          閲覧したページの本文を保存し、検索窓で「<kbd style={kbdStyle}>{prefix || 'f'}</kbd> キーワード」と入力すると本文から探せます。
        </p>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '6px 0 0', opacity: 0.85 }}>
          保存データはこのPC内（拡張機能のストレージ）にのみ保存され、外部へ送信されません。
        </p>
      </div>

      <Section title="本文の保存">
        <ToggleRow
          label="閲覧したページの本文を保存する"
          description="オフにすると新しく開いたページは保存されません。保存済みのページはそのまま検索できます。"
          checked={settings.fulltextEnabled}
          onChange={v => save({ fulltextEnabled: v })}
        />
      </Section>

      <Section title="全文検索プレフィックス">
        <label style={labelStyle}>全文検索専用のショートカットキーワード</label>
        <input
          type="text"
          value={settings.fulltextShortcut}
          onChange={e => save({ fulltextShortcut: e.target.value })}
          style={{ ...inputStyle, width: '96px', borderColor: prefixWarning ? 'var(--danger)' : 'var(--border)' }}
        />
        {prefixWarning ? (
          <p style={{ fontSize: '12px', color: 'var(--danger)', margin: '6px 0 0' }}>{prefixWarning}</p>
        ) : (
          <p style={hintStyle}>
            検索窓で「{prefix} キーワード」と入力
            {prefix.length === 1 && <>、または <kbd style={kbdStyle}>Alt+{prefix.toUpperCase()}</kbd> で切り替え</>}
          </p>
        )}
      </Section>

      <Section title="検索結果">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <ToggleRow
            label="通常の検索にも本文の一致を表示する"
            description="プレフィックスなしの検索で、本文が一致したページを最大3件、履歴の後に表示します。"
            checked={settings.fulltextInDefault}
            onChange={v => save({ fulltextInDefault: v })}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            全文検索モードの最大表示件数
            <input
              type="number"
              min={1}
              max={50}
              value={settings.maxFulltextResults}
              onChange={e => save({ maxFulltextResults: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })}
              style={{ ...inputStyle, width: '80px' }}
            />
          </label>
        </div>
      </Section>

      <Section title="保存状況">
        {stats.status === 'loading' && <p style={mutedStyle}>読み込み中...</p>}
        {stats.status === 'error' && (
          <p style={{ ...mutedStyle, color: 'var(--danger)' }}>全文検索エンジンに接続できません：{stats.error}</p>
        )}
        {stats.status === 'ready' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
            <Stat label="保存ページ" value={stats.stats.pages.toLocaleString()} />
            <Stat label="うち本文あり" value={stats.stats.fullPages.toLocaleString()} />
            <Stat label="データ容量" value={formatMB(stats.stats.dbBytes)} />
            <Stat
              label="期間"
              value={stats.stats.oldest && stats.stats.newest
                ? `${formatDate(stats.stats.oldest)} 〜 ${formatDate(stats.stats.newest)}`
                : '—'}
              small
            />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button onClick={() => { setStats({ status: 'loading' }); loadStats(); }} style={linkBtnStyle}>
            再読み込み
          </button>
        </div>
      </Section>

      <Section title="除外ルール">
        <p style={{ ...mutedStyle, margin: '0 0 12px' }}>
          URLがパターンに一致するページは保存しません。<kbd style={kbdStyle}>%</kbd> は任意の文字列に一致します（例: <code style={codeStyle}>https://mail.google.com/%</code>）。
        </p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            type="text"
            value={newPattern}
            onChange={e => setNewPattern(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddRule(); }}
            placeholder="https://example.com/%"
            style={{ ...inputStyle, flex: 1, minWidth: 0, fontFamily: monoFont }}
          />
          <select
            value={newLevel}
            onChange={e => setNewLevel(e.target.value as ExcludeRule['level'])}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="no_index">{LEVEL_LABELS.no_index}</option>
            <option value="url_only">{LEVEL_LABELS.url_only}</option>
          </select>
          <button
            onClick={handleAddRule}
            disabled={!newPattern.trim()}
            style={{ ...accentBtnStyle, opacity: newPattern.trim() ? 1 : 0.4 }}
          >
            <IconAdd size={16} />
            追加
          </button>
        </div>
        {rulesError && <p style={{ fontSize: '12px', color: 'var(--danger)', margin: '0 0 8px' }}>{rulesError}</p>}
        {rules === null && !rulesError && <p style={mutedStyle}>読み込み中...</p>}
        {rules && rules.length === 0 && <p style={mutedStyle}>ルールはありません。</p>}
        {rules && rules.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '320px', overflowY: 'auto' }}>
            {rules.map(rule => (
              <div
                key={rule.id}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 6px 6px 12px', backgroundColor: 'var(--surface-hover)', borderRadius: '6px' }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: '12px', fontFamily: monoFont, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rule.pattern}>
                  {rule.pattern}
                </span>
                <span
                  style={{
                    fontSize: '11px', padding: '1px 8px', borderRadius: '999px', flexShrink: 0,
                    border: '1px solid var(--border)',
                    color: rule.level === 'no_index' ? 'var(--text)' : 'var(--text-secondary)',
                  }}
                >
                  {LEVEL_LABELS[rule.level]}
                </span>
                <button onClick={() => handleRemoveRule(rule)} style={{ ...actionBtnStyle, color: 'var(--danger)' }} aria-label="削除">
                  <IconDelete size={14} />
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="データ">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* FTTF からの取り込み */}
          <div>
            <div style={subHeadStyle}>Full Text Tabs Forever から取り込む</div>
            <p style={{ ...mutedStyle, margin: '0 0 10px' }}>
              Full Text Tabs Forever の設定画面の「Export」で書き出した .json ファイルを選択してください。
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) handleImportFile(file);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importBusy}
              style={{ ...secondaryBtnStyle, opacity: importBusy ? 0.5 : 1, cursor: importBusy ? 'default' : 'pointer' }}
            >
              <IconImport size={16} />
              JSONファイルを選択
            </button>
            <ImportProgress state={importState} />
          </div>

          <div style={{ borderTop: '1px solid var(--border)' }} />

          {/* 削除 */}
          <div>
            <div style={subHeadStyle}>ドメイン単位で削除</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={domainInput}
                onChange={e => setDomainInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleDeleteDomain(); }}
                placeholder="example.com"
                style={{ ...inputStyle, width: '240px' }}
              />
              <button
                onClick={handleDeleteDomain}
                disabled={deleting || !domainInput.trim()}
                style={{ ...dangerOutlineBtnStyle, opacity: deleting || !domainInput.trim() ? 0.5 : 1 }}
              >
                <IconDelete size={14} />
                削除
              </button>
            </div>
          </div>

          <div>
            <div style={subHeadStyle}>保存済みページをすべて削除</div>
            <p style={{ ...mutedStyle, margin: '0 0 10px' }}>除外ルールと設定は残ります。</p>
            <button
              onClick={handleDeleteAll}
              disabled={deleting}
              style={{ ...dangerBtnStyle, opacity: deleting ? 0.5 : 1 }}
            >
              <IconDelete size={16} />
              すべて削除
            </button>
          </div>

          {deleteMessage && (
            <p style={{ fontSize: '13px', margin: 0, color: deleteMessage.ok ? 'var(--success)' : 'var(--danger)' }}>
              {deleteMessage.text}
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}

function ImportProgress({ state }: { state: ImportState }) {
  if (state.phase === 'idle') return null;
  if (state.phase === 'uploading') {
    return <p style={{ ...mutedStyle, margin: '10px 0 0' }}>ファイルを読み込み中...</p>;
  }
  if (state.phase === 'error') {
    return <p style={{ fontSize: '13px', color: 'var(--danger)', margin: '10px 0 0' }}>取り込みに失敗しました：{state.error}</p>;
  }
  if (state.phase === 'done') {
    return (
      <p style={{ fontSize: '13px', color: 'var(--success)', margin: '10px 0 0' }}>
        {state.imported.toLocaleString()} 件を取り込みました
        {state.skipped > 0 && <span style={{ color: 'var(--text-secondary)' }}>（{state.skipped.toLocaleString()} 件はスキップ）</span>}
      </p>
    );
  }
  const ratio = state.total ? Math.min(1, state.done / state.total) : null;
  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{ height: '6px', borderRadius: '999px', backgroundColor: 'var(--surface-hover)', overflow: 'hidden', position: 'relative' }}>
        {ratio !== null ? (
          <div style={{ height: '100%', width: `${ratio * 100}%`, backgroundColor: 'var(--accent)', borderRadius: '999px', transition: 'width 0.4s ease' }} />
        ) : (
          <div className="os-progress-indeterminate" style={{ height: '100%', width: '30%', backgroundColor: 'var(--accent)', borderRadius: '999px', position: 'absolute' }} />
        )}
      </div>
      <p style={{ ...mutedStyle, margin: '6px 0 0', fontVariantNumeric: 'tabular-nums' }}>
        取り込み中… {state.done.toLocaleString()}
        {state.total !== null && ` / ${state.total.toLocaleString()}`} 件
        {ratio !== null && `（${Math.floor(ratio * 100)}%）`}
      </p>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', color: 'var(--text)' }}>{label}</div>
        {description && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{description}</div>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative', width: '36px', height: '20px', borderRadius: '999px', flexShrink: 0,
          border: 'none', cursor: 'pointer', padding: 0,
          backgroundColor: checked ? 'var(--accent)' : 'var(--border)',
          transition: 'background-color 0.15s',
        }}
      >
        <span
          style={{
            position: 'absolute', top: '2px', left: checked ? '18px' : '2px',
            width: '16px', height: '16px', borderRadius: '999px', backgroundColor: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.3)', transition: 'left 0.15s',
          }}
        />
      </button>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div style={{ backgroundColor: 'var(--surface-hover)', borderRadius: '6px', padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{label}</div>
      <div
        style={{
          fontSize: small ? '13px' : '18px', fontWeight: 600, marginTop: small ? '6px' : '2px',
          fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{title}</h2>
      <div style={{ backgroundColor: 'var(--surface)', borderRadius: '8px', padding: '16px' }}>{children}</div>
    </div>
  );
}

const monoFont = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--surface-hover)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  padding: '6px 10px',
  fontSize: '13px',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  fontSize: '13px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px',
};

const hintStyle: React.CSSProperties = {
  fontSize: '12px', color: 'var(--text-secondary)', margin: '6px 0 0',
};

const mutedStyle: React.CSSProperties = {
  fontSize: '13px', color: 'var(--text-secondary)', margin: 0,
};

const subHeadStyle: React.CSSProperties = {
  fontSize: '13px', fontWeight: 500, color: 'var(--text)', marginBottom: '6px',
};

const kbdStyle: React.CSSProperties = {
  backgroundColor: 'var(--surface-hover)', padding: '1px 5px', borderRadius: '4px', fontSize: '12px',
};

const codeStyle: React.CSSProperties = {
  fontFamily: monoFont, fontSize: '12px',
};

const accentBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px',
  padding: '6px 12px', borderRadius: '6px', fontSize: '13px',
  backgroundColor: 'var(--accent)', border: 'none',
  color: '#fff', cursor: 'pointer', flexShrink: 0,
};

const secondaryBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px',
  padding: '6px 12px', borderRadius: '6px', fontSize: '13px',
  backgroundColor: 'var(--surface-hover)', border: '1px solid var(--border)',
  color: 'var(--text)', cursor: 'pointer',
};

const dangerOutlineBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px',
  padding: '6px 12px', borderRadius: '6px', fontSize: '13px',
  backgroundColor: 'transparent', border: '1px solid var(--danger)',
  color: 'var(--danger)', cursor: 'pointer',
};

const dangerBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px',
  padding: '6px 12px', borderRadius: '6px', fontSize: '13px',
  backgroundColor: 'var(--danger)', border: 'none',
  color: '#fff', cursor: 'pointer',
};

const actionBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px',
  fontSize: '12px', color: 'var(--text-secondary)',
  background: 'none', border: 'none', cursor: 'pointer',
  padding: '4px 8px',
};

const linkBtnStyle: React.CSSProperties = {
  fontSize: '12px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
};
