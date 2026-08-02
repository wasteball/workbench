import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

if (!Blob.prototype.text) {
  Object.defineProperty(Blob.prototype, 'text', {
    value(this: Blob) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(String(reader.result ?? '')), { once: true });
        reader.addEventListener('error', () => reject(reader.error), { once: true });
        reader.readAsText(this);
      });
    },
  });
}
