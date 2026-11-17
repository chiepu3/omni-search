import ReactDOM from 'react-dom/client';
import { App } from './App';
// フォントは同梱（外部のGoogle Fontsへ接続しない）
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@/styles/options.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
