import { normalizeText } from '../text/normalize-text.js';
import { readDataFile } from './data.js';

interface UsedMarkers {
  phrases: string[];
  rawTitlePatterns: string[];
}

/**
 * Whether a title describes a used, refurbished or display unit (SPEC §8.4 step 1): a used phrase
 * in the normalized title, or a raw-title pattern such as "99%". Such items are skipped.
 */
export function isUsedTitle(title: string): boolean {
  const markers = readDataFile<UsedMarkers>('used-markers.json');
  const n = ` ${normalizeText(title)} `;
  return (
    markers.phrases.some((phrase) => n.includes(` ${phrase} `)) ||
    markers.rawTitlePatterns.some((pattern) => new RegExp(pattern, 'i').test(title))
  );
}
