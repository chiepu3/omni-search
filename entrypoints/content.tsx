import ReactDOM from 'react-dom/client';
import { useState, useEffect } from 'react';
import { SearchModal } from '@/components/SearchModal';
import '@/styles/content.css';

function App() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (message: Record<string, unknown>) => {
      if (message.action === 'TOGGLE_SEARCH') {
        setVisible(v => !v);
      }
      if (message.action === 'HIDE_SEARCH') {
        setVisible(false);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  if (!visible) return null;
  return <SearchModal onClose={() => setVisible(false)} />;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'omni-search-root',
      position: 'overlay',
      zIndex: 2147483640,
      anchor: 'body',
      onMount(container) {
        const root = ReactDOM.createRoot(container);
        root.render(<App />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
