import { LlamaContext } from 'llama.rn';

// ── Embedding helpers ──
// An embedding turns text into a vector so that *similar meaning → nearby vectors*.
// For this to work, the embedding context MUST be created with a real pooling type
// (mean/cls/last). Without it, llama.cpp returns identical/near-constant vectors for
// every input — which silently breaks all semantic search. See PLAN.md, Phase 1.

export type EmbeddingTaskType = 'document' | 'query';

/** 
 * Embed a single piece of text into a Float32 vector.
 * Supports Nomic Embed Text v1.5 asymmetric prefixes:
 * - 'search_document: ' when indexing a note/memory
 * - 'search_query: ' when searching from user chat
 */
export async function embedText(
  ctx: LlamaContext,
  text: string,
  taskType: EmbeddingTaskType = 'document'
): Promise<Float32Array> {
  const clean = text.trim();
  const prefix = taskType === 'query' ? 'search_query: ' : 'search_document: ';
  const prompt = clean.startsWith('search_query:') || clean.startsWith('search_document:')
    ? clean
    : `${prefix}${clean}`;

  const res = await ctx.embedding(prompt);
  return new Float32Array(res.embedding);
}

/**
 * Cosine similarity of two equal-length vectors, in [-1, 1].
 * 1 = identical direction, 0 = unrelated, <0 = opposite.
 * (Scale-invariant, so it works whether or not vectors are pre-normalized.)
 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface EmbeddingSelfTestResult {
  passed: boolean;
  /** cosine(anchor, paraphrase) — should be HIGH */
  simRelated: number;
  /** cosine(anchor, unrelated) — should be LOW */
  simUnrelated: number;
  /** how many of the vector's first values were distinct across inputs (sanity) */
  detail: string;
}

/**
 * Verifies the embedding model returns DISTINCT, semantically meaningful vectors.
 *
 * This is the single most important check in the project: it catches the
 * "constant vector" failure (a missing/incorrect pooling type) that makes the
 * model return the same vector for every input, silently defeating RAG.
 *
 * Calls are intentionally SEQUENTIAL — that is the exact scenario the original
 * bug report described ("constant vectors when called sequentially").
 *
 * Pass criteria:
 *   1. Vectors are not all near-identical (not the constant-vector bug).
 *   2. A paraphrase query is closer to the stored anchor document than an unrelated query.
 *   3. The gap between (2) is meaningful (> 0.05), not noise.
 */
export async function runEmbeddingSelfTest(ctx: LlamaContext): Promise<EmbeddingSelfTestResult> {
  const anchor = 'The cat sat on the warm windowsill in the afternoon sun.';
  const paraphrase = 'Where was the kitten resting?';
  const unrelated = 'Quarterly corporate tax filings are due at the end of the month.';

  // Anchor is stored as document; queries are searched as queries
  const vAnchor = await embedText(ctx, anchor, 'document');
  const vParaphrase = await embedText(ctx, paraphrase, 'query');
  const vUnrelated = await embedText(ctx, unrelated, 'query');

  const simRelated = cosineSimilarity(vAnchor, vParaphrase);
  const simUnrelated = cosineSimilarity(vAnchor, vUnrelated);

  // The classic bug: everything is ~1.0 because every vector is the same.
  const looksConstant = simRelated > 0.999 && simUnrelated > 0.999;
  const ordered = simRelated > simUnrelated;
  const margin = simRelated - simUnrelated;
  const passed = !looksConstant && ordered && margin > 0.05;

  const detail = looksConstant
    ? 'Vectors are near-identical for all inputs → constant-vector bug (check pooling_type).'
    : `related=${simRelated.toFixed(3)} > unrelated=${simUnrelated.toFixed(3)} (margin ${margin.toFixed(3)})`;

  return { passed, simRelated, simUnrelated, detail };
}
