import { normalizeText } from '../text/normalize-text.js';
import { readDataFile } from './data.js';

/** The canonical color key of a color text such as "Xanh dương" or "Space Gray", or null. */
export function canonicalColor(text: string): string | null {
  const n = normalizeText(text);
  if (!n) {
    return null;
  }
  const colors = readDataFile<Record<string, string[]>>('colors.json');
  for (const [key, phrases] of Object.entries(colors)) {
    if (phrases.includes(n)) {
      return key;
    }
  }
  return null;
}
