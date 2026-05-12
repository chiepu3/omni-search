export default defineBackground(() => {
  // キーボードショートカットでコンテンツスクリプトにトグル通知
  browser.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-search') {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        try {
          await browser.tabs.sendMessage(tab.id, { action: 'TOGGLE_SEARCH' });
        } catch {
          // content script not loaded yet
        }
      }
    }
  });

  // 履歴検索・URLオープンはバックグラウンドで処理
  browser.runtime.onMessage.addListener((message: Record<string, unknown>) => {
    if (message.action === 'SEARCH_HISTORY') {
      const query = message.query as string;
      return chrome.history.search({
        text: query,
        maxResults: 100,
        startTime: 0,
      }).then(items =>
        items.map(item => ({
          id: item.id ?? '',
          url: item.url ?? '',
          title: item.title ?? '',
          lastVisitTime: item.lastVisitTime ?? 0,
          visitCount: item.visitCount ?? 0,
        }))
      );
    }

    if (message.action === 'OPEN_URL') {
      const url = message.url as string;
      const target = message.target as string;
      if (target === 'tab') {
        browser.tabs.create({ url });
      } else if (target === 'window') {
        browser.windows.create({ url });
      } else {
        browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
          if (tab?.id) browser.tabs.update(tab.id, { url });
        });
      }
    }

    if (message.action === 'SEARCH_BOOKMARKS') {
      const query = (message.query as string).toLowerCase();
      const flattenBookmarks = (nodes: chrome.bookmarks.BookmarkTreeNode[]): { id: string; title: string; url: string }[] => {
        const results: { id: string; title: string; url: string }[] = [];
        for (const node of nodes) {
          if (node.url) {
            results.push({ id: node.id, title: node.title || node.url, url: node.url });
          }
          if (node.children) {
            results.push(...flattenBookmarks(node.children));
          }
        }
        return results;
      };
      return chrome.bookmarks.getTree().then(tree => {
        const all = flattenBookmarks(tree);
        if (!query) return all.slice(0, 20);
        return all.filter(b =>
          b.title.toLowerCase().includes(query) || b.url.toLowerCase().includes(query)
        ).slice(0, 20);
      });
    }

    if (message.action === 'OPEN_OPTIONS') {
      browser.runtime.openOptionsPage();
    }
  });
});
