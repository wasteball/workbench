import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SettingsProvider } from '@/app/settings-context';
import { ThemeEffect } from '@/app/theme-effect';
import '@/app/styles/global.css';

import { PopupApp } from './PopupApp';
import './popup.css';

const root = document.getElementById('root');
if (!root) throw new Error('Popup root element was not found');

createRoot(root).render(
  <StrictMode>
    <SettingsProvider>
      <ThemeEffect />
      <PopupApp />
    </SettingsProvider>
  </StrictMode>,
);
