import { createRoot } from 'react-dom/client';
import { App } from './pulse-renderer';
import styles from './pulse-renderer.module.css';

const root = document.getElementById('pulse-renderer-root')!;
root.classList.add(styles.pulseRendererRoot);
createRoot(root).render(<App />);
