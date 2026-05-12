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
  });
});
