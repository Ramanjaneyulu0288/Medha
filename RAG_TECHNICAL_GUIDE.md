# Medha: Technical Guide to On-Device RAG

This document provides a deep-dive into how the Retrieval-Augmented Generation (RAG) pipeline was implemented in Medha. It serves as a blueprint for rebuilding this architecture from scratch.

---

## 1. High-Performance Inference: `llama.rn`

The core of the system is **`llama.rn`**, a React Native wrapper for `llama.cpp`. We use it because it leverages JSI (JavaScript Interface) for near-native performance and supports high-quality GGUF quantization.

### How to Initialize (The "Brain")
Initialising the model requires allocating a native context. In Medha, we use a **`LlamaContext`** for each model instance.

```typescript
const context = await initLlama({
  model: 'path/to/model.gguf', // Full file path on device
  n_ctx: 2048,                 // Context length (tokens)
  n_gpu_layers: 1              // Number of layers to offload to GPU
});
```

### Why GGUF?
- **Quantization**: We use `Q4_K_M` or `Q5_K_M` quantization. This reduces a 10GB model to ~1.6GB, making it possible to run on a phone with 6-8GB RAM.
- **Unified Format**: Support for almost any modern LLM (Gemma, Llama 3, Phi-3).

---

## 2. The Dual-Context Architecture

Running an LLM and an Embedding model on one device is memory-intensive. We achieved this by maintaining two separate concurrent contexts:

1.  **Encoder (all-MiniLM-L6-v2.gguf)**:
    - **Size**: ~50MB.
    - **Purpose**: Fast vectorization of text into 384-dimension floats.
    - **Config**: `embedding: true` must be set during `initLlama`.
2.  **Thinker (Gemma-2B-IT.gguf)**:
    - **Size**: ~1.6GB.
    - **Purpose**: Generative reasoning and natural language response.
    - **State**: Shared via a `BrainStore` singleton to avoid re-loads during navigation.

---

## 3. Vector Database: `sqlite-vec`

We used **`sqlite-vec`** (v0.1.7) as our vector engine. It is a pure-C SQLite extension for fast nearest-neighbor search.

### Integration Strategy
We statically linked `sqlite-vec` into **`react-native-nitro-sqlite`** using a post-install shell script:
1.  **Pathing**: Copied `sqlite-vec.c` into the `cpp/` directory of the native module.
2.  **Hooking**: Modified `operations.cpp` to call `sqlite3_vec0_register(db)` immediately after opening any database.

### Schema Design
```sql
-- The Virtual Table for vectors
CREATE VIRTUAL TABLE notes_vec USING vec0(embedding float[384]);

-- The Metadata Table for content
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### The "Integer Overlap" Fix
**Critical Edge Case**: JavaScript `Number` types are always passed as `Float` via JSI. `sqlite-vec` strictly demands `INTEGER` for the `rowid`.
- **Solution**: Instead of binding the ID as a parameter (`?`), we interpolate the integer directly into the SQL string:
```typescript
db.execute(`INSERT INTO notes_vec (rowid, embedding) VALUES (${Math.floor(Number(id))}, ?)`, [buffer]);
```

---

### Step 1: Smart Hybrid Retrieval
To eliminate "context pollution" (e.g., Babu vs. Surya), we use a weighted search that combines semantic similarity with exact keyword matching.

```sql
SELECT 
  notes.id, 
  notes.content, 
  (1.0 / (notes_vec.distance + 0.01)) + (CASE WHEN notes.content LIKE ? THEN 8.0 ELSE 0.0 END) as total_rank
FROM notes_vec
JOIN notes ON notes.id = notes_vec.rowid
WHERE embedding MATCH ? AND k = 10
ORDER BY total_rank DESC
LIMIT 7;
```
*Note: We use a +8.0 weight for exact name matches. This ensures relevant facts always outrank semantically similar noise.*

### Step 2: Contextual Subject Pinning
We inject the last 3-4 chat messages into the prompt under a `RECENT CONVERSATION` block. This allows the model to track "He" or "She" across multiple turns even if the name isn't repeated.

### Step 3: Prompt Construction (Reasoning V2.1)
We use the **"Strikeout Method"** to force small models into algorithmic precision:
1. **Primary Subject**: Identify the core person.
2. **Raw Facts**: List everything retrieved.
3. **Strikeout**: Explicitly reject notes that don't match the subject.
4. **ABORT**: A circuit breaker if no facts survive.
5. **Net State**: Final math only on valid data.

```text
<start_of_turn>system
You are Medha. Use these notes if relevant:
[RELEVANT NOTES]
- The wifi password is 'galaxy123'
<end_of_turn>
<start_of_turn>user
What was the wifi password again?<end_of_turn>
<start_of_turn>model
<thinking>
```

### Step 3: Streaming (Real-time feedback)
To handle the latency of on-device LLMs, we stream responses character-by-character:

```typescript
const result = await context.completion({
  prompt: finalPrompt,
  stop: ["<end_of_turn>"]
}, (token) => {
  // Callback fires for every token generated
  updateUI(token.text);
});
```

---

## 5. UI and UX Patterns

### Persistence: The `BrainStore` Singleton
Loading a 2GB model takes 5-10 seconds. We prevent this from happening more than once by storing the `LlamaContext` in a global singleton:
```typescript
export const brainStore = {
  db: null,
  embedContext: null // Singleton LlamaContext
};
```

### Keyboard & Layout
- **KeyboardAvoidingView**: Set to `behavior="height"` on Android and wrap the *entire* screen layout (FlatList + Input) to ensure the message list compresses properly when the keyboard rises.
- **Cancel Button**: Always provide a `stopCompletion()` button. On-device LLMs can generate long outputs that drain battery if the user is already satisfied with the answer.

---

## 6. Summary of Key Learnings

1.  **RAM is King**: 2B models need at least 6GB of total system RAM. 7B models (Mistral/DeepSeek) require 8-12GB for stability.
2.  **Strikeout Logic**: Small LLMs are prone to "Working Memory" failures. Always use a rejection-based scratchpad to keep them grounded.
3.  **Keyword Weighting**: Pure vector search is often too "fuzzy." A 5.0-8.0 point SQL boost for exact keywords solves 90% of retrieval noise.
4.  **Binary Assets**: Use `metro.config.js` to register `.gguf` as an asset extension.
