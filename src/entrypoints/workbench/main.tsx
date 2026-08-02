import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DestinationProvider } from '@/app/destination-context';
import { SettingsProvider } from '@/app/settings-context';
import { WorkbenchApp } from '@/app/shell/WorkbenchApp';
import '@/app/styles/global.css';
import { ThemeEffect } from '@/app/theme-effect';

const root = document.getElementById('root');
if (!root) throw new Error('Workbench root element was not found');

createRoot(root).render(
  <StrictMode>
    <SettingsProvider>
      <ThemeEffect />
      <DestinationProvider>
        <WorkbenchApp />
      </DestinationProvider>
    </SettingsProvider>
  </StrictMode>,
);
