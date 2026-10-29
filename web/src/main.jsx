import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '@/components/ui/sonner';
import App from './App';
import './index.css';

// Dark mode follows the OS setting.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <Toaster richColors position="top-center" />
  </StrictMode>,
);
