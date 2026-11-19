/**
 * Normalizes text for matching and search (SPEC §8.2):
 * NFC → lowercase → đ→d → NFD and strip combining marks → every character outside [a-z0-9]
 * becomes a space → collapse spaces → trim.
 *
 * "Điện thoại Novix X5 256GB - Chính hãng VN/A" → "dien thoai novix x5 256gb chinh hang vn a"
 */
export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
