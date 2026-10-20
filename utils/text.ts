// ── Text helpers ──

// Common English question/stop words that carry no retrieval signal. Boosting on
// these (e.g. "what", "is", "my") would match almost everything, so we drop them
// before building the keyword half of the hybrid search.
const STOPWORDS = new Set([
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
  'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
  'the', 'a', 'an', 'my', 'mine', 'me', 'i', 'we', 'us', 'our',
  'you', 'your', 'yours', 'he', 'she', 'it', 'they', 'them', 'their',
  'of', 'to', 'do', 'does', 'did', 'done', 'and', 'or', 'but', 'so',
  'in', 'on', 'at', 'by', 'for', 'with', 'about', 'from', 'into',
  'that', 'this', 'these', 'those', 'there', 'here',
  'have', 'has', 'had', 'can', 'could', 'would', 'should', 'will', 'shall', 'may',
  'please', 'tell', 'show', 'give', 'get', 'again',
]);

/**
 * Extract meaningful keywords from a query for keyword-boosted search.
 * Lowercases, strips punctuation (Unicode-aware), drops short words and stop words,
 * and de-duplicates. Returns [] when nothing meaningful remains.
 */
export function extractKeywords(text: string, max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)) {
    if (word.length <= 2 || STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= max) break;
  }
  return out;
}
