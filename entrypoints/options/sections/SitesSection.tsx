import { useState, useEffect } from 'react';
import { storage } from '@/lib/storage';
import type { SiteConfig } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { IconAdd, IconEdit, IconDelete } from '@/components/icons';

const BLANK: Omit<SiteConfig, 'id'> = {
  name: '',
  shortcut: '',
  urlTemplate: '',
  domains: [''],
  color: '#7c3aed',
};

export function SitesSection() {
  const [sites, setSites] = useState<SiteConfig[]>([]);
  const [editing, setEditing] = useState<SiteConfig | null>(null);

  useEffect(() => {
    storage.getSites().then(setSites);
  }, []);

  const save = async (updated: SiteConfig[]) => {
    setSites(updated);
    await storage.saveSites(updated);
  };

  const handleAdd = () => {
    setEditing({ id: uuidv4(), ...BLANK });
  };

  const handleSave = async (site: SiteConfig) => {
    const idx = sites.findIndex(s => s.id === site.id);
    const next = idx >= 0
      ? sites.map(s => s.id === site.id ? site : s)
      : [...sites, site];
    await save(next);
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このサイトを削除しますか？')) return;
    await save(sites.filter(s => s.id !== id));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
          ショートカットキーワードを登録して、任意のサイトを素早く検索できます。
        </p>
        <button
          onClick={handleAdd}
          style={accentBtnStyle}
        >
          <IconAdd size={16} />
          サイトを追加
        </button>
      </div>

      {sites.length === 0 && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', padding: '32px 0' }}>
          サイトが登録されていません。
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {sites.map(site => (
          <div
            key={site.id}
            style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--surface)', borderRadius: '8px', padding: '12px 16px' }}
          >
            <span
              style={{ width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, flexShrink: 0, backgroundColor: site.color || '#7c3aed' }}
            >
              {site.name.charAt(0).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: '13px' }}>{site.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <kbd style={{ backgroundColor: 'var(--surface-hover)', padding: '1px 4px', borderRadius: '3px', fontSize: '11px' }}>{site.shortcut}</kbd>
                {' → '}
                {site.urlTemplate}
              </div>
            </div>
            <button
              onClick={() => setEditing(site)}
              style={actionBtnStyle}
            >
              <IconEdit size={14} />
              編集
            </button>
            <button
              onClick={() => handleDelete(site.id)}
              style={{ ...actionBtnStyle, color: 'var(--danger)' }}
            >
              <IconDelete size={14} />
              削除
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <SiteEditor
          site={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SiteEditor({
  site,
  onSave,
  onCancel,
}: {
  site: SiteConfig;
  onSave: (s: SiteConfig) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SiteConfig>({ ...site });

  const set = (patch: Partial<SiteConfig>) => setForm(f => ({ ...f, ...patch }));

  const setDomain = (idx: number, value: string) => {
    const domains = [...form.domains];
    domains[idx] = value;
    set({ domains });
  };
  const addDomain = () => set({ domains: [...form.domains, ''] });
  const removeDomain = (idx: number) => {
    const domains = form.domains.filter((_, i) => i !== idx);
    set({ domains: domains.length ? domains : [''] });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div style={{ backgroundColor: 'var(--surface)', borderRadius: '12px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', padding: '24px', width: '100%', maxWidth: '512px', display: 'flex', flexDirection: 'column', gap: '16px', border: '1px solid var(--border)' }}>
        <h3 style={{ fontWeight: 600, fontSize: '16px', margin: 0 }}>
          {site.name ? `編集: ${site.name}` : '新しいサイト'}
        </h3>

        <Field label="サイト名">
          <input type="text" value={form.name} onChange={e => set({ name: e.target.value })}
            style={inputCls} placeholder="例: Jira" />
        </Field>

        <Field label="ショートカット">
          <input type="text" value={form.shortcut} onChange={e => set({ shortcut: e.target.value })}
            style={inputCls} placeholder="例: j" />
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0' }}>このキーワード + スペース + クエリで検索します</p>
        </Field>

        <Field label="URLテンプレート">
          <input type="text" value={form.urlTemplate} onChange={e => set({ urlTemplate: e.target.value })}
            style={inputCls} placeholder="https://example.com/search?q={query}" />
        </Field>

        <Field label="ドメイン（履歴フィルタ用）">
          {form.domains.map((d, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
              <input type="text" value={d} onChange={e => setDomain(i, e.target.value)}
                style={{ ...inputCls, flex: 1 }} placeholder="example.com" />
              <button onClick={() => removeDomain(i)} style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <IconDelete size={16} />
              </button>
            </div>
          ))}
          <button onClick={addDomain} style={{ fontSize: '12px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
            + ドメインを追加
          </button>
        </Field>

        <Field label="パスプレフィックス（任意）">
          <input type="text" value={form.pathPrefix ?? ''} onChange={e => set({ pathPrefix: e.target.value || undefined })}
            style={inputCls} placeholder="例: /myorg （このパス以下のみ履歴フィルタ対象）" />
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0' }}>指定するとそのパス以下のURLのみ履歴に表示されます</p>
        </Field>

        <Field label="テーマカラー">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input type="color" value={form.color || '#7c3aed'} onChange={e => set({ color: e.target.value })}
              style={{ height: '32px', width: '48px', borderRadius: '6px', cursor: 'pointer', backgroundColor: 'transparent', border: 'none' }} />
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{form.color}</span>
          </div>
        </Field>

        <div style={{ display: 'flex', gap: '8px', paddingTop: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel}
            style={cancelBtnStyle}>
            キャンセル
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.name || !form.shortcut || !form.urlTemplate}
            style={accentBtnStyle}
          >
            保存
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

const inputCls: React.CSSProperties = {
  width: '100%', backgroundColor: 'var(--surface-hover)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px',
  fontSize: '13px', outline: 'none',
};

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
