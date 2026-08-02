import { useEffect, useRef, useState } from 'react';

import { useSettings } from '@/app/settings-context';
import type { AccentColor, ReadingFont } from '@/shared/types';

import './reading-settings-panel.css';

const ACCENTS: Array<{ value: AccentColor; label: string }> = [
  { value: 'indigo', label: '靛蓝' },
  { value: 'amber', label: '琥珀' },
  { value: 'blue', label: '蓝色' },
  { value: 'green', label: '绿色' },
  { value: 'pink', label: '玫红' },
  { value: 'cyan', label: '青色' },
];

export function ReadingSettingsPanel() {
  const { settings, update } = useSettings();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [fontSize, setFontSize] = useState(settings.readingFontSize);
  const [readingWidth, setReadingWidth] = useState(settings.readingWidth);
  const updateTimer = useRef<number | null>(null);
  const pendingUpdate = useRef<Parameters<typeof update>[0]>({});

  useEffect(() => setFontSize(settings.readingFontSize), [settings.readingFontSize]);
  useEffect(() => setReadingWidth(settings.readingWidth), [settings.readingWidth]);
  useEffect(() => () => {
    if (updateTimer.current !== null) window.clearTimeout(updateTimer.current);
  }, []);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target as Node)) details.removeAttribute('open');
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !detailsRef.current?.open) return;
      detailsRef.current.removeAttribute('open');
      detailsRef.current.querySelector<HTMLElement>('summary')?.focus();
    };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const queueUpdate = (patch: Parameters<typeof update>[0]) => {
    pendingUpdate.current = { ...pendingUpdate.current, ...patch };
    if (updateTimer.current !== null) window.clearTimeout(updateTimer.current);
    updateTimer.current = window.setTimeout(() => {
      updateTimer.current = null;
      const next = pendingUpdate.current;
      pendingUpdate.current = {};
      void update(next);
    }, 100);
  };

  const setFont = (value: ReadingFont) => void update({ readingFont: value });

  return (
    <details className="reading-settings" ref={detailsRef}>
      <summary aria-label="阅读设置" title="阅读设置">Aa</summary>
      <div className="reading-settings__panel">
        <section>
          <div className="reading-settings__label"><span>正文字体</span></div>
          <div className="reading-settings__segments" role="group" aria-label="正文字体">
            <button aria-pressed={settings.readingFont === 'serif'} onClick={() => setFont('serif')} type="button">衬线</button>
            <button aria-pressed={settings.readingFont === 'sans'} onClick={() => setFont('sans')} type="button">无衬线</button>
          </div>
        </section>

        <section>
          <label className="reading-settings__label" htmlFor="reading-font-size"><span>字体大小</span><output>{fontSize}px</output></label>
          <input
            id="reading-font-size"
            max="26"
            min="14"
            onChange={(event) => {
              const value = Number(event.target.value);
              setFontSize(value);
              queueUpdate({ readingFontSize: value });
            }}
            step="1"
            type="range"
            value={fontSize}
          />
        </section>

        <section>
          <label className="reading-settings__label" htmlFor="reading-width"><span>Reading width</span><output>{readingWidth}px</output></label>
          <input
            id="reading-width"
            max="1200"
            min="560"
            onChange={(event) => {
              const value = Number(event.target.value);
              setReadingWidth(value);
              queueUpdate({ readingWidth: value });
            }}
            step="20"
            type="range"
            value={readingWidth}
          />
        </section>

        <section>
          <div className="reading-settings__label"><span>界面颜色</span></div>
          <div className="reading-settings__swatches" role="group" aria-label="界面颜色">
            {ACCENTS.map((accent) => (
              <button
                aria-label={accent.label}
                aria-pressed={settings.accentColor === accent.value}
                data-accent={accent.value}
                key={accent.value}
                onClick={() => void update({ accentColor: accent.value })}
                title={accent.label}
                type="button"
              ><span /></button>
            ))}
          </div>
        </section>
      </div>
    </details>
  );
}
