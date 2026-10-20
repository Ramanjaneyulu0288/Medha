export type RouteIntent = 'NOTES_ADD' | 'NOTES_SEARCH' | 'CALENDAR' | 'GENERAL_CHAT' | 'WEB_SEARCH' | 'FINANCIAL_QUERY';

// ── Keyword-based Intent Router (fast-path) ──
// Explicit commands like "/note ...", financial debt queries, or search queries
// are deterministically recognized for instant, zero-latency execution.

const INTENT_PATTERNS: { intent: RouteIntent; patterns: RegExp[] }[] = [
  {
    intent: 'NOTES_ADD',
    patterns: [
      /^\/note\s/i,
      /^save this/i,
      /^remember (that|this)/i,
      /^note (this|for later)/i,
      /^write (this )?down/i,
      /^add (a |this )?note/i,
      /^store (this|that)/i,
    ]
  },
  {
    intent: 'FINANCIAL_QUERY',
    patterns: [
      /(?:how much|what)(?: does)?\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+owe/i,
      /(?:how much|what)(?: do)?\s+i\s+owe\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
      /(?:did|has)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+(?:pay|repay|settle|clear)/i,
      /owe\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
      /who\s+owes\s+me/i,
      /(?:what are|check|show|list)\s+(?:my\s+)?debts/i,
      /(?:balance|ledger|status)\s+(?:with|for)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
      /(?:settle|settled|cleared)\s+with\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
      /(?:do i owe|does anyone owe|who do i owe)/i,
    ]
  },
  {
    intent: 'WEB_SEARCH',
    patterns: [
      /^(google|search the web|search online|look up online|browse for|open browser)/i,
      /^search (the )?(web|internet|google) for/i,
    ]
  },
  {
    intent: 'CALENDAR',
    patterns: [
      /^(set a |create a |add a )?(reminder|calendar event|event)/i,
      /^schedule /i,
      /^remind me /i,
      /^add to (my )?calendar/i,
    ]
  },
  {
    intent: 'NOTES_SEARCH',
    patterns: [
      /^(search|find|lookup|look up|check)( in)?( my)? notes? (for|about)/i,
      /^(what did i (save|write|note) (about|for)|show (my )?notes)/i,
      /^what('s| is) (in|on) my notes/i,
    ]
  },
  // GENERAL_CHAT doesn't need patterns.
  // Any query that doesn't match the above will fall through to GENERAL_CHAT.
];

/**
 * Extracts a target person's name from financial questions (e.g., "How much Suresh owe me?" -> "suresh")
 */
export function extractFinancialTargetPerson(query: string): string | null {
  const clean = query.trim();

  const stopWords = new Set([
    'me', 'i', 'you', 'my', 'money', 'much', 'the', 'all', 'any', 'anyone', 'someone', 'everyone',
    'people', 'debts', 'debt', 'do i', 'did i', 'are my', 'who', 'whom', 'which', 'what'
  ]);

  // 1. User owes someone: "how much do I owe Suresh", "what do I owe Uncle Bob"
  const userOwesMatch = clean.match(/(?:how much|what)?\s*(?:do\s+i|did\s+i)\s+owe\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i);
  if (userOwesMatch && userOwesMatch[1]) {
    const candidate = userOwesMatch[1].trim().toLowerCase();
    if (!stopWords.has(candidate)) return candidate;
  }

  // 2. Someone owes user: "how much does Suresh owe me", "how much Suresh owe me"
  const personOwesMatch = clean.match(/(?:how much|what)?\s*(?:does\s+)?([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+owe/i);
  if (personOwesMatch && personOwesMatch[1]) {
    const candidate = personOwesMatch[1].trim().toLowerCase();
    if (!stopWords.has(candidate)) return candidate;
  }

  // 3. Payment check: "did Suresh pay me back", "has Suresh settled"
  const paymentMatch = clean.match(/(?:did|has)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+(?:pay|repay|settle|clear)/i);
  if (paymentMatch && paymentMatch[1]) {
    const candidate = paymentMatch[1].trim().toLowerCase();
    if (!stopWords.has(candidate)) return candidate;
  }

  // 4. Balance/ledger with: "balance with Suresh", "ledger for Uncle Bob"
  const balanceMatch = clean.match(/(?:balance|ledger|status)\s+(?:with|for)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i);
  if (balanceMatch && balanceMatch[1]) {
    const candidate = balanceMatch[1].trim().toLowerCase();
    if (!stopWords.has(candidate)) return candidate;
  }

  // 5. Possessive debt: "Suresh's debt" (explicit 's required)
  const possessiveMatch = clean.match(/([a-zA-Z]+(?:\s+[a-zA-Z]+)?)(?:'s)\s+debt/i);
  if (possessiveMatch && possessiveMatch[1]) {
    const candidate = possessiveMatch[1].trim().toLowerCase();
    if (!stopWords.has(candidate)) return candidate;
  }

  return null;
}

/**
 * Classifies user intent using deterministic keyword matching.
 * Falls back to GENERAL_CHAT, which still runs the full RAG pipeline.
 */
export function getSemanticIntent(query: string): RouteIntent {
  const trimmed = query.trim();

  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        console.log(`[Semantic Router] Matched intent: ${intent} (pattern: ${pattern})`);
        return intent;
      }
    }
  }

  // Default: GENERAL_CHAT runs the full RAG pipeline (notes search + LLM)
  console.log(`[Semantic Router] No specific intent matched, defaulting to GENERAL_CHAT (full RAG)`);
  return 'GENERAL_CHAT';
}
