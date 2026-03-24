/** 漂流瓶正文：仅允许英文（至少含一个拉丁字母，且不含中日韩等字符）。 */

const HAS_LATIN = /[a-zA-Z]/;
const NON_ENGLISH_SCRIPTS =
  /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff]/;

export function isEnglishOnlyBottleContent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!HAS_LATIN.test(t)) return false;
  if (NON_ENGLISH_SCRIPTS.test(t)) return false;
  return true;
}
