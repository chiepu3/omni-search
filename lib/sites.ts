import type { SiteConfig } from '@/types';

export function buildUrl(site: SiteConfig, query: string): string {
  return site.urlTemplate.replace('{query}', encodeURIComponent(query));
}

export function matchSiteShortcut(
  input: string,
  sites: SiteConfig[]
): { site: SiteConfig; query: string } | null {
  const trimmed = input.trimStart();
  const lower = trimmed.toLowerCase();
  for (const site of sites) {
    const sc = site.shortcut.toLowerCase();
    const prefix = sc + ' ';
    if (lower.startsWith(prefix)) {
      return { site, query: trimmed.slice(prefix.length) };
    }
    if (lower === sc) {
      return { site, query: '' };
    }
  }
  return null;
}
