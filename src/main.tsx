import { createRoot } from 'react-dom/client';
import App from './app/App';
import { Session } from './app/Session';
import './app/styles.css';
import './app/theme.css';
createRoot(document.getElementById('root')!).render(<Session><App /></Session>);
