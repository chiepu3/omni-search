import { useState, useEffect } from 'react';
import { storage } from '@/lib/storage';
import type { SiteConfig } from '@/types';
import { v4 as uuidv4 } from 'uuid';

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
    if (!confirm('Delete this site?')) return;
    await save(sites.filter(s => s.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">
          Define shortcut keywords that search specific sites.<br />
          Example: shortcut <code className="bg-white/10 px-1 rounded">s</code> + URL template <code className="bg-white/10 px-1 rounded">https://site.com/search?q={'{'}query{'}'}</code>
        </p>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded"
        >
          + Add site
        </button>
      </div>

      {sites.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-8">No sites configured.</p>
      )}

      <div className="space-y-2">
        {sites.map(site => (
          <div
            key={site.id}
            className="flex items-center gap-3 bg-white/5 rounded-lg px-4 py-3"
          >
            <span
              className="w-8 h-8 rounded flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ backgroundColor: site.color || '#7c3aed' }}
            >
              {site.name.charAt(0).toUpperCase()}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{site.name}</div>
              <div className="text-xs text-gray-400 truncate">
                <kbd className="bg-white/10 px-1 rounded">{site.shortcut}</kbd>
                {' → '}
                {site.urlTemplate}
              </div>
            </div>
            <button
              onClick={() => setEditing(site)}
              className="text-xs text-gray-400 hover:text-white px-2"
            >
              Edit
            </button>
            <button
              onClick={() => handleDelete(site.id)}
              className="text-xs text-red-400 hover:text-red-300 px-2"
            >
              Delete
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-4 border border-white/10">
        <h3 className="font-semibold text-lg">
          {site.name ? `Edit: ${site.name}` : 'New site'}
        </h3>

        <Field label="Site name">
          <input type="text" value={form.name} onChange={e => set({ name: e.target.value })}
            className={inputCls} placeholder="e.g. Jira" />
        </Field>

        <Field label="Shortcut keyword">
          <input type="text" value={form.shortcut} onChange={e => set({ shortcut: e.target.value })}
            className={inputCls} placeholder="e.g. j" />
          <p className="text-xs text-gray-500 mt-1">Type this + space + query to search</p>
        </Field>

        <Field label="URL template">
          <input type="text" value={form.urlTemplate} onChange={e => set({ urlTemplate: e.target.value })}
            className={inputCls} placeholder="https://example.com/search?q={query}" />
        </Field>

        <Field label="Domains (for history filtering)">
          {form.domains.map((d, i) => (
            <div key={i} className="flex gap-2 mb-1">
              <input type="text" value={d} onChange={e => setDomain(i, e.target.value)}
                className={`${inputCls} flex-1`} placeholder="example.com" />
              <button onClick={() => removeDomain(i)} className="text-red-400 hover:text-red-300 px-2">×</button>
            </div>
          ))}
          <button onClick={addDomain} className="text-xs text-violet-400 hover:text-violet-300">
            + Add domain
          </button>
        </Field>

        <Field label="Theme color">
          <div className="flex items-center gap-3">
            <input type="color" value={form.color || '#7c3aed'} onChange={e => set({ color: e.target.value })}
              className="h-8 w-12 rounded cursor-pointer bg-transparent" />
            <span className="text-sm text-gray-400">{form.color}</span>
          </div>
        </Field>

        <div className="flex gap-2 pt-2 justify-end">
          <button onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded bg-white/10 hover:bg-white/20 text-gray-300">
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.name || !form.shortcut || !form.urlTemplate}
            className="px-4 py-1.5 text-sm rounded bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
          >
            Save
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
