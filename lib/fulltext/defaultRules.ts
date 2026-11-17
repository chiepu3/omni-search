import type { ExcludeRule } from './protocol';

// 初回のみ投入する。削除された既定ルールは再投入しない。
export const DEFAULT_RULES: Omit<ExcludeRule, 'id'>[] = [
  ...[
    '%://localhost%', '%://127.%', '%://[::1]%', '%://0.0.0.0%', '%://%.local/%', '%://%.local:%',
    '%://%.internal/%', '%://%.internal:%',
    '%://192.168.%', '%://10.%',
    ...Array.from({ length: 16 }, (_, i) => `%://172.${16 + i}.%`),
    '%://mail.google.com/%', '%://outlook.live.com/%', '%://outlook.office.com/%',
    '%://%.proton.me/%', '%://mail.yahoo.%',
    '%://vault.bitwarden.%', '%://%.1password.com/%', '%://1password.com/%',
    '%://%.lastpass.com/%', '%://app.dashlane.com/%',
    '%://%.bankofamerica.com/%', '%://%.chase.com/%', '%://%.wellsfargo.com/%',
    '%://%.paypal.com/%', '%://paypal.com/%',
    '%://%.rakuten-bank.co.jp/%', '%://%.netbk.co.jp/%', '%://%.japannetbank.co.jp/%',
    '%://%.paypay-bank.co.jp/%', '%://%.jibunbank.co.jp/%', '%://%.sonybank.net/%',
    '%://%.bk.mufg.jp/%', '%://%.smbc.co.jp/%', '%://%.mizuhobank.co.jp/%',
    '%://%.sbisec.co.jp/%', '%://%.rakuten-sec.co.jp/%', '%://%.monex.co.jp/%',
  ].flatMap(pattern => {
    const patterns = pattern.includes('://%.') ? [pattern, pattern.replace('://%.', '://')] : [pattern];
    return patterns.map(pattern => ({ pattern, level: 'no_index' as const }));
  }),
  ...[
    '%://www.google.%/search%', '%://www.bing.com/search%',
    '%://search.yahoo.%/search%', '%://duckduckgo.com/%',
    // 以下は FTTF の既定リストから流用（海外専用の検索エンジン・米国の地銀/証券は除外）
    '%://kagi.com/search%', '%://www.reddit.com/search%',
    '%://news.ycombinator.com/', '%://news.ycombinator.com/news', '%://news.ycombinator.com/new', '%://news.ycombinator.com/best',
    '%://x.com/', '%://x.com/home', '%://twitter.com/', '%://twitter.com/home',
    '%://www.facebook.com/', '%://www.linkedin.com/', '%://www.tiktok.com/',
    '%://drive.google.com/%', '%://docs.google.com/%', '%://www.office.com/%',
    '%://www.dropbox.com/', '%://slack.com/', '%://app.slack.com/%', '%://zoom.us/%',
    '%://discord.com/channels/%',
    '%://www.amazon.com/%', '%://www.amazon.co.jp/%', '%://www.ebay.com/%',
    '%://www.coinbase.com/%', '%://www.robinhood.com/%',
  ].map(pattern => ({ pattern, level: 'url_only' as const })),
];
