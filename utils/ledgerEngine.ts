import { readRows } from './db';
import { LlamaContext } from 'llama.rn';

export type TransactionDirection = 'GAVE' | 'RECEIVED';

export interface LedgerTransaction {
  id?: number;
  note_id: number;
  person: string;
  original_name: string;
  direction: TransactionDirection;
  amount: number;
  currency: string;
  created_at?: string;
  note_content?: string;
}

export interface PersonBalanceSummary {
  person: string;
  totalGave: number;
  totalReceived: number;
  netBalance: number; // Positive = Person owes user; Negative = User owes person; 0 = Settled
  currency: string;
  transactions: LedgerTransaction[];
}

export interface OverallBalanceSummary {
  creditors: { person: string; amountOwedToUser: number }[]; // People who owe the user
  debtors: { person: string; amountUserOwes: number }[];      // People the user owes
  totalOwedToUser: number;
  totalUserOwes: number;
  netBalance: number;
  currency: string;
}

/**
 * Initializes the SQLite ledger table with cascading foreign keys to `notes`.
 */
export function initLedgerTable(db: any): void {
  if (!db) return;
  try {
    db.execute('PRAGMA foreign_keys = ON;');
    db.execute(`
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id INTEGER NOT NULL,
        person TEXT NOT NULL,
        original_name TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'INR',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
      );
    `);
    db.execute('CREATE INDEX IF NOT EXISTS idx_ledger_person ON ledger(person);');
    db.execute('CREATE INDEX IF NOT EXISTS idx_ledger_note_id ON ledger(note_id);');
    console.log('[ledgerEngine] Table initialized successfully.');
  } catch (e) {
    console.error('[ledgerEngine] Failed to init ledger table:', e);
  }
}

const INVALID_NAMES = new Set([
  'me', 'i', 'myself', 'him', 'her', 'them', 'someone', 'everyone', 'us', 'we', 'you',
  'yesterday', 'today', 'tomorrow', 'money', 'cash', 'dollars', 'rupees', 'bucks', 'inr',
  'food', 'dinner', 'lunch', 'breakfast', 'cab', 'uber', 'petrol', 'rent', 'bill', 'back'
]);

function cleanPersonName(raw: string): { normalized: string; display: string } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let words = trimmed.split(/\s+/).filter(Boolean);

  // Strip trailing helper words like 'back', 'for', 'to'
  while (words.length > 0 && ['back', 'for', 'to', 'from'].includes(words[words.length - 1].toLowerCase())) {
    words.pop();
  }

  if (words.length === 0 || words.length > 2) return null;

  for (const w of words) {
    if (INVALID_NAMES.has(w.toLowerCase())) return null;
  }

  const normalized = words.join(' ').toLowerCase();
  const display = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return { normalized, display };
}

/**
 * Converts English text numbers ("fifty", "hundred", etc.) or multipliers ("2k", "1.5k", "1 lakh") to numbers.
 */
function parseAmount(text: string): number | null {
  if (!text) return null;
  const clean = text
    .trim()
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/^[₹$€£]\s*/, '')
    .replace(/\s*(?:rs\.?|rupees?|bucks?|inr)$/, '')
    .trim();
  
  // Handle multipliers like 2k, 1.5k
  const kMatch = clean.match(/^([\d.]+)\s*k$/);
  if (kMatch) {
    const val = parseFloat(kMatch[1]);
    return isNaN(val) ? null : Math.round(val * 1000);
  }
  
  // Handle lakh: 1 lakh, 2.5 lakh, 1.5l, 2l
  const lakhMatch = clean.match(/^([\d.]+)\s*(?:lakhs?|l)$/);
  if (lakhMatch) {
    const val = parseFloat(lakhMatch[1]);
    return isNaN(val) ? null : Math.round(val * 100000);
  }

  // Direct float
  const directNum = parseFloat(clean);
  if (!isNaN(directNum) && directNum > 0) {
    return directNum;
  }

  // Text number word dictionary
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    hundred: 100, 'a hundred': 100, thousand: 1000, 'a thousand': 1000
  };

  if (words[clean]) return words[clean];

  return null;
}

/**
 * Tier 1: Fast zero-latency Regex Transaction Extractor.
 * Handles common English transaction phrasing in 0 milliseconds.
 * Strictly adheres to 1-to-1 transactions (avoids speculative split math).
 */
export function extractTransactionRegex(text: string): Omit<LedgerTransaction, 'note_id'> | null {
  const clean = text.trim();

  // Strict 1-on-1 policy: If multiple people are mentioned (e.g. "and", "&"), skip regex
  if (/\b(?:and|along with|\+|&)\b/i.test(clean)) {
    return null;
  }

  // Amount pattern supporting numbers, k, lakh, or written words
  const amtRegex = `(?:[₹$]?\\s*([\\d.]+(?:\\s*k|\\s*lakh|\\s*l)?)\\s*(?:rs\\.?|rupees?|bucks?|inr)?|(?:a\\s+)?(?:hundred|thousand|fifty|twenty|thirty|forty))`;
  const nameRegex = `([a-zA-Z]+(?:\\s+[a-zA-Z]+)?)`;

  // Pattern A: User GAVE money to Person (Direction = GAVE)
  // - "I gave Suresh 50 rupees", "gave 50 to Suresh", "lent Suresh 100", "I lent Suresh 100"
  // - "paid Suresh back 100", "paid 100 for Suresh"
  // - "Suresh borrowed 500 from me" (Suresh borrowed = User gave!)
  const gavePatterns: { regex: RegExp; nameIdx: number; amtIdx: number }[] = [
    { regex: new RegExp(`(?:i\\s+)?(?:gave|transferred|sent)\\s+${nameRegex}\\s+${amtRegex}`, 'i'), nameIdx: 1, amtIdx: 2 },
    { regex: new RegExp(`(?:i\\s+)?(?:gave|transferred|sent)\\s+${amtRegex}\\s+to\\s+${nameRegex}`, 'i'), nameIdx: 2, amtIdx: 1 },
    { regex: new RegExp(`(?:i\\s+)?lent\\s+${nameRegex}\\s+${amtRegex}`, 'i'), nameIdx: 1, amtIdx: 2 },
    { regex: new RegExp(`(?:i\\s+)?paid\\s+${nameRegex}\\s+(?:back\\s+)?${amtRegex}`, 'i'), nameIdx: 1, amtIdx: 2 },
    { regex: new RegExp(`(?:i\\s+)?paid\\s+${amtRegex}\\s+(?:to|for|on\\s+behalf\\s+of)\\s+${nameRegex}`, 'i'), nameIdx: 2, amtIdx: 1 },
    { regex: new RegExp(`${nameRegex}\\s+(?:borrowed|took)\\s+${amtRegex}\\s+from\\s+me`, 'i'), nameIdx: 1, amtIdx: 2 },
  ];

  for (const { regex, nameIdx, amtIdx } of gavePatterns) {
    const m = clean.match(regex);
    if (m && m[nameIdx] && m[amtIdx]) {
      const personObj = cleanPersonName(m[nameIdx]);
      const amount = parseAmount(m[amtIdx]);
      if (personObj && amount) {
        return {
          person: personObj.normalized,
          original_name: personObj.display,
          direction: 'GAVE',
          amount,
          currency: 'INR',
        };
      }
    }
  }

  // Pattern B: User RECEIVED money from Person (Direction = RECEIVED)
  // - "Suresh gave me 100 rupees", "received 100 from Suresh", "Suresh returned 50"
  // - "Suresh paid me back 100", "Suresh repaid me 100"
  // - "Suresh lent me 500" (Suresh lent me = User received!)
  // - "I borrowed 100 from Suresh" (User borrowed = User received!)
  const receivedPatterns: { regex: RegExp; nameIdx: number; amtIdx: number }[] = [
    { regex: new RegExp(`${nameRegex}\\s+(?:gave\\s+me|paid\\s+me(?:\\s+back)?|returned|sent\\s+me|repaid\\s+me)\\s+${amtRegex}`, 'i'), nameIdx: 1, amtIdx: 2 },
    { regex: new RegExp(`${nameRegex}\\s+lent\\s+me\\s+${amtRegex}`, 'i'), nameIdx: 1, amtIdx: 2 },
    { regex: new RegExp(`(?:i\\s+)?(?:received|got|collected|borrowed)\\s+${amtRegex}\\s+from\\s+${nameRegex}`, 'i'), nameIdx: 2, amtIdx: 1 },
    { regex: new RegExp(`(?:i\\s+)?borrowed\\s+${amtRegex}\\s+from\\s+${nameRegex}`, 'i'), nameIdx: 2, amtIdx: 1 },
  ];

  for (const { regex, nameIdx, amtIdx } of receivedPatterns) {
    const m = clean.match(regex);
    if (m && m[nameIdx] && m[amtIdx]) {
      const personObj = cleanPersonName(m[nameIdx]);
      const amount = parseAmount(m[amtIdx]);
      if (personObj && amount) {
        return {
          person: personObj.normalized,
          original_name: personObj.display,
          direction: 'RECEIVED',
          amount,
          currency: 'INR',
        };
      }
    }
  }

  return null;
}

/**
 * Tier 2: LLM-powered Micro Extractor.
 * Fallback for conversational, unstructured sentences when regex fails.
 */
export async function extractTransactionLLM(
  text: string,
  chatCtx: LlamaContext
): Promise<Omit<LedgerTransaction, 'note_id'> | null> {
  try {
    const prompt = `<|im_start|>system
You are a financial entity extraction engine. Determine if the note describes money given, lent, borrowed, or received between the User and another single named person.
If the User GAVE or PAID money for someone -> direction = "GAVE"
If the User RECEIVED or BORROWED money from someone -> direction = "RECEIVED"
Always normalize currency to INR.
Output ONLY a JSON object: {"person": string, "amount": number, "direction": "GAVE"|"RECEIVED", "currency": "INR"}
If no financial transaction or multiple people are mentioned, output: {"is_financial": false}<|im_end|>
<|im_start|>user
Note: "Suresh gave me a hundred bucks"<|im_end|>
<|im_start|>assistant
{"person": "Suresh", "amount": 100, "direction": "RECEIVED", "currency": "INR"}<|im_end|>
<|im_start|>user
Note: "${text}"<|im_end|>
<|im_start|>assistant
`;

    let generated = '';
    await chatCtx.completion(
      { prompt, n_predict: 64, temperature: 0.1, stop: ['<|im_end|>', '}'] },
      (res) => { generated += res.token; }
    );
    generated = generated.trim();
    if (!generated.endsWith('}')) generated += '}';

    const parsed = JSON.parse(generated);
    if (parsed.is_financial === false || !parsed.person || !parsed.amount || !parsed.direction) {
      return null;
    }

    const personObj = cleanPersonName(String(parsed.person));
    const amount = Number(parsed.amount);
    const direction = parsed.direction === 'RECEIVED' ? 'RECEIVED' : 'GAVE';

    if (amount > 0 && personObj) {
      return {
        person: personObj.normalized,
        original_name: personObj.display,
        direction,
        amount,
        currency: 'INR',
      };
    }
    return null;
  } catch (e) {
    console.warn('[ledgerEngine] LLM extraction error:', e);
    return null;
  }
}

/**
 * Dual-Tier Extractor: Tries Tier-1 Regex first; falls back to Tier-2 LLM if available.
 */
export async function extractTransaction(
  text: string,
  chatCtx?: LlamaContext | null
): Promise<Omit<LedgerTransaction, 'note_id'> | null> {
  // 1. Try fast regex
  const regexResult = extractTransactionRegex(text);
  if (regexResult) {
    console.log('[ledgerEngine] Tier-1 Regex extracted transaction:', regexResult);
    return regexResult;
  }

  // 2. Try LLM if available and text looks vaguely financial
  if (chatCtx) {
    const hasFinancialClues = /(?:money|cash|paid|lent|borrowed|owe|spent|bucks|rupees|rs|cost|split|dinner|lunch|\d+)/i.test(text);
    if (hasFinancialClues) {
      console.log('[ledgerEngine] Tier-2 running LLM extractor for:', text);
      const llmResult = await extractTransactionLLM(text, chatCtx);
      if (llmResult) {
        console.log('[ledgerEngine] Tier-2 LLM extracted transaction:', llmResult);
        return llmResult;
      }
    }
  }

  return null;
}

/**
 * Extracts and inserts a financial transaction linked to a saved note.
 */
export async function recordLedgerFromNote(
  db: any,
  noteId: number,
  noteText: string,
  chatCtx?: LlamaContext | null
): Promise<LedgerTransaction | null> {
  if (!db || !noteId) return null;

  try {
    const extracted = await extractTransaction(noteText, chatCtx);
    if (!extracted) return null;

    db.execute(
      `INSERT INTO ledger (note_id, person, original_name, direction, amount, currency) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [noteId, extracted.person, extracted.original_name, extracted.direction, extracted.amount, extracted.currency]
    );

    console.log(`[ledgerEngine] Saved ledger entry for note ${noteId}: ${extracted.direction} ₹${extracted.amount} (${extracted.person})`);
    return { ...extracted, note_id: noteId };
  } catch (e) {
    console.error('[ledgerEngine] Error recording ledger from note:', e);
    return null;
  }
}

/**
 * Queries exact balance with a specific person.
 * Returns 100% deterministic arithmetic.
 */
export function getPersonBalance(db: any, personName: string): PersonBalanceSummary | null {
  if (!db || !personName) return null;
  const normalized = personName.trim().toLowerCase();

  try {
    const sumRes = db.execute(
      `SELECT 
         original_name,
         SUM(CASE WHEN direction = 'GAVE' THEN amount ELSE 0 END) as total_gave,
         SUM(CASE WHEN direction = 'RECEIVED' THEN amount ELSE 0 END) as total_received,
         SUM(CASE WHEN direction = 'GAVE' THEN amount ELSE -amount END) as net_balance
       FROM ledger 
       WHERE person = ?
       GROUP BY person`,
      [normalized]
    );

    const rows = readRows<any>(sumRes);
    if (rows.length === 0) return null;

    const row = rows[0];
    const txRes = db.execute(
      `SELECT ledger.*, notes.content as note_content
       FROM ledger
       JOIN notes ON notes.id = ledger.note_id
       WHERE ledger.person = ?
       ORDER BY ledger.created_at ASC`,
      [normalized]
    );
    const transactions = readRows<LedgerTransaction>(txRes);

    return {
      person: row.original_name || personName,
      totalGave: Number(row.total_gave || 0),
      totalReceived: Number(row.total_received || 0),
      netBalance: Number(row.net_balance || 0),
      currency: 'INR',
      transactions,
    };
  } catch (e) {
    console.error('[ledgerEngine] Error getting person balance:', e);
    return null;
  }
}

/**
 * Queries all balances across all people.
 */
export function getAllBalances(db: any): OverallBalanceSummary {
  const result: OverallBalanceSummary = {
    creditors: [],
    debtors: [],
    totalOwedToUser: 0,
    totalUserOwes: 0,
    netBalance: 0,
    currency: 'INR',
  };

  if (!db) return result;

  try {
    const res = db.execute(`
      SELECT 
        original_name,
        SUM(CASE WHEN direction = 'GAVE' THEN amount ELSE -amount END) as net_balance
      FROM ledger
      GROUP BY person
      ORDER BY ABS(net_balance) DESC
    `);
    const rows = readRows<any>(res);

    for (const r of rows) {
      const net = Number(r.net_balance || 0);
      const name = r.original_name;
      if (net > 0) {
        result.creditors.push({ person: name, amountOwedToUser: net });
        result.totalOwedToUser += net;
      } else if (net < 0) {
        result.debtors.push({ person: name, amountUserOwes: Math.abs(net) });
        result.totalUserOwes += Math.abs(net);
      }
    }
    result.netBalance = result.totalOwedToUser - result.totalUserOwes;
  } catch (e) {
    console.error('[ledgerEngine] Error getting all balances:', e);
  }

  return result;
}

/**
 * Synchronizes historical notes into the ledger table.
 * Used by the manual sync button in Notes tab.
 */
export async function syncLedgerFromNotes(
  db: any,
  chatCtx?: LlamaContext | null,
  onProgress?: (current: number, total: number) => void
): Promise<number> {
  if (!db) return 0;

  try {
    const res = db.execute('SELECT id, content FROM notes WHERE id NOT IN (SELECT note_id FROM ledger)');
    const missing = readRows<{ id: number; content: string }>(res);
    if (missing.length === 0) return 0;

    let addedCount = 0;
    for (let i = 0; i < missing.length; i++) {
      if (onProgress) onProgress(i + 1, missing.length);
      const item = missing[i];
      const recorded = await recordLedgerFromNote(db, item.id, item.content, chatCtx);
      if (recorded) addedCount++;
    }

    console.log(`[ledgerEngine] Synced ${addedCount} historical transactions into ledger.`);
    return addedCount;
  } catch (e) {
    console.error('[ledgerEngine] Error during ledger sync:', e);
    return 0;
  }
}
