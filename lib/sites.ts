import type { SiteConfig } from '@/types';

export function buildUrl(site: SiteConfig, query: string): string {
  return site.urlTemplate.replace('{query}', encodeURIComponent(query));
}

export function matchSiteShortcut(
  input: string,
  sites: SiteConfig[]
): { site: SiteConfig; query: string } | null {
  const trimmed = input.trimStart();
  for (const site of sites) {
    const prefix = site.shortcut + ' ';
    if (trimmed.startsWith(prefix)) {
      return { site, query: trimmed.slice(prefix.length) };
    }
    // exact shortcut with no space (just shortcut keyword alone)
    if (trimmed === site.shortcut) {
      return { site, query: '' };
    }
  }
  return null;
}
