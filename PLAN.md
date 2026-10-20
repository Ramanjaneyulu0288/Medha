# Medha — Build & Learning Roadmap

> **Goal:** a fully private, on-device AI assistant that chats, stores your data safely,
> summarizes, and eventually performs tasks autonomously — with **all inference running
> locally on the edge device** (no cloud).
>
> **How we'll work:** one phase at a time. Each phase teaches a concept, ships a small
> working improvement, and has a clear "done" check. Don't move on until the current
> phase's check passes and you understand *why* it works.

This document is the result of dedicated research (June 2026) into current edge models,
embeddings, mobile inference runtimes, on-device agents, and secure storage. Sources are
listed at the end. Where 2026 releases are bleeding-edge and only sourced from blogs,
they're marked **(verify at build time)**.

---

## 0. The big picture (read this first)

An on-device assistant is really **five subsystems** stacked on top of a local model
runtime. We'll build them in roughly this dependency order:

```
            ┌─────────────────────────────────────────────┐
            │            UI  (chat, notes, models)         │
            └─────────────────────────────────────────────┘
   5. AUTONOMY  →  agent loop, device tools, scheduling
   4. SUMMARIZE →  map-reduce + rolling conversation memory
   3. TOOLS     →  function calling via grammar-constrained output
   2. PRIVACY   →  encrypted-at-rest store + key in secure enclave
   1. MEMORY    →  embeddings + vector search (RAG) — the "second brain"
            ┌─────────────────────────────────────────────┐
            │   RUNTIME: llama.rn (llama.cpp) + GGUF       │
            └─────────────────────────────────────────────┘
```

Two findings shape everything below, so internalize them now:

1. **Your RAG is probably broken today.** Your embedding context is initialized without a
   pooling type ([index.tsx:393](app/(tabs)/index.tsx#L393)), which is the textbook cause
   of llama.cpp returning identical/near-constant vectors — exactly the symptom your
   [Router.ts](utils/Router.ts) comment describes. The keyword router is a workaround for a
   bug, not a design choice. **Phase 1 fixes this**, and it likely makes semantic search
   actually work for the first time.

2. **Small models can't "just" do tool calling.** Generic sub-7B models frequently fail to
   invoke tools at all. The fix isn't only a bigger model — it's **grammar-constrained
   decoding** (forcing structurally valid output) + a **tool-trained** model + a **small
   tool list**. Phase 3 is built around this.

---

## 1. Decisions locked in by the research

So we don't re-litigate these every phase:

| Decision | Choice | Why |
|---|---|---|
| **Inference runtime** | **Stay on `llama.rn`** | Most mature RN option, widest GGUF support, best structured-output story (GBNF + JSON-Schema→grammar), multimodal-capable, actively maintained (v0.12.x, 2026). Nothing has clearly overtaken it for *flexible* RN use. |
| **Model format** | **GGUF** | Any model, any quant, no per-device ahead-of-time compile step. |
| **Default quant** | **Q4_K_M** | Best quality/size tradeoff for phones. Q8 only for tiny embedding models or 8GB+ phones. |
| **SQLite layer** | **Migrate to `@op-engineering/op-sqlite`** (Phase 2) | It gives you *documented* sqlite-vec support **and** SQLCipher encryption in one library — replacing your hand-rolled [patch-sqlite-vec.sh](scripts/patch-sqlite-vec.sh) hack and unlocking Phase 2 encryption. |
| **Acceleration** | **GPU first (Metal on iOS), NPU is a bonus** | For 3–8B decode, GPU beats NPU in practice (NPU shines on prefill + power). Don't over-invest in NPU. |
| **iOS fast-path (later)** | **Apple Foundation Models** via `@react-native-ai/apple`, as an *optional* opportunistic path on iOS 26+ devices, with llama.rn as the universal fallback | Zero download, zero RAM, free, private, native tool calling — but iOS-only and device-gated, so it can never be the *only* engine. |

---

## 2. Model picks (the "which models are best" answer)

> Landscape moves fast. The **well-established** picks below are safe today. The 2026
> headline models (Gemma 4, MiniCPM-V 4.6, etc.) appeared mostly in blog sources during
> research — treat as **(verify at build time)** before committing.

### 2a. Embedding model (powers RAG)

| Model | Dim | Size (Q4/quant) | Notes |
|---|---|---|---|
| **all-MiniLM-L6-v2** *(you have this)* | 384 | ~45–90 MB | Safe baseline. **First just fix pooling** — it may be all you need. Apache-2.0. |
| **EmbeddingGemma-300M** ⭐ upgrade | 768 → MRL **256** | <200 MB | Best-in-class sub-500M quality (MTEB ~70 @768d). Use **256-d Matryoshka** truncation → 1 KB/vector → 10k notes ≈ 10 MB. Mean pooling. Gemma license. |
| **bge-small-en-v1.5** | 384 | ~130 MB | Apache-2.0 alternative, beats MiniLM at same dims. |

**Plan:** fix MiniLM first (Phase 1). Consider EmbeddingGemma @256-d once RAG is proven.
**Critical:** every embedding model needs the correct **pooling type** (`mean` for MiniLM
and EmbeddingGemma).

### 2b. Chat / reasoning model

The honest tension: bigger = better reasoning *and* tool calling, but RAM/heat/speed are
hard ceilings on a phone. Pick by the user's RAM tier.

| Role | Model | Q4_K_M disk | ~RAM | Why |
|---|---|---|---|---|
| **Fast / low-RAM** | Llama 3.2 1B, or Gemma 3n **E2B** | 0.8–1.3 GB | 1–1.5 GB | Snappy chat on any phone; weak reasoning/tools. |
| **Best default (sweet spot)** ⭐ | **Qwen3-4B** | ~2.5 GB | ~3 GB | Best reasoning **and** tool-calling per GB at small size; thinking mode. (Note: 32K ctx.) |
| **Multimodal-future default** | Gemma 3n / **Gemma 4 E4B** *(verify)* | ~2.5 GB | ~3 GB | Native function calling + image/audio; MatFormer/PLE = big model in little RAM; 128K ctx. |
| **Max quality (8GB+ phones)** | **Qwen3-8B** | ~5 GB | ~5.5–6 GB | Most reliable agentic/tool use under 10B; needs an 8GB phone with little headroom. |

You currently ship **Dolphin-Llama-3.1-8B (4.9 GB)** and **Gemma 4 E4B** in
[models.tsx](app/(tabs)/models.tsx). Recommendation: **add Qwen3-4B as the default** and a
**small fast option**, so the app is usable on mid-range phones, not just 8GB flagships.

**Tool-calling reliability ranking (small models):** Qwen3-8B > Qwen3-4B > Gemma 4 E4B >
SmolLM3-3B > Phi-4-mini > Llama 3.2 3B. Below ~3–4B, only attempt tool calling *with*
grammar constraints and a tiny tool set.

---

## 3. The phased roadmap

Each phase: **Concept → Build → Done-check.** Keep PRs small.

### Phase 0 — Hygiene & ground truth *(½ day)*
Small cleanup so we build on solid ground.
- **Build:**
  - `git rm --cached medha_brain.db` and add it to `.gitignore` (a real DB is committed).
  - Replace the boilerplate [README.md](README.md) with one paragraph describing Medha + a
    link to this plan.
  - Extract the copy-pasted DB row-parsing (`rows._array` / `rows.item()` / array) — it's
    duplicated in 4+ places — into one `readRows(res)` helper in `utils/`.
- **Done-check:** repo is clean; app still builds and runs.
- **Concepts:** repo hygiene, why DB files don't belong in git.

### Phase 1 — Make RAG actually work *(the keystone)*
**Concept:** embeddings turn text into vectors; *similar meaning → nearby vectors*. Cosine
similarity measures "nearby." Pooling (mean/CLS) collapses per-token vectors into one
sentence vector. **No pooling = garbage/constant vectors.**

- **Build:**
  1. Fix the embedding context init. Add an explicit pooling type and batch sizes:
     ```ts
     await initLlama({
       model: embedModelUri,
       embedding: true,
       pooling_type: 'mean',   // ← the fix; verify exact key in your llama.rn version
       n_batch: 512,
       n_ubatch: 512,          // must equal n_batch in embedding mode
       n_ctx: 512,
     })
     ```
  2. **Prove it with a test:** embed two unrelated sentences and one paraphrase; assert
     `cosine(paraphrase, original) > cosine(unrelated, original)` and that similarity is
     **not ~0.999** for everything. This single test is the most important check in the
     whole project.
  3. Once embeddings are real, **make the semantic router actually semantic** (or keep the
     keyword router as a fast pre-filter — your call, now an informed one).
  4. Improve retrieval: add a `chunks` table (note → chunks) so long notes split at
     paragraph boundaries (~256–512 tokens, **no overlap** to start). Keep your hybrid
     vector + `LIKE` boost; consider FTS5 later.
- **Done-check:** the cosine test passes; asking about a stored note retrieves *that* note,
  not keyword-matched noise.
- **Concepts:** embeddings, pooling, cosine similarity, RAG, chunking, Matryoshka dims.

### Phase 2 — Privacy: encrypt everything at rest
**Concept:** "private" means *if someone steals the phone/file, your data is unreadable.*
That's **encryption at rest** (SQLCipher, AES-256) + a **key kept in the OS secure enclave**
(Keychain/Keystore), optionally **biometric-gated**.

- **Build:**
  1. Migrate from `react-native-nitro-sqlite` → **`@op-engineering/op-sqlite`** (gives you
     sqlite-vec *and* SQLCipher). This retires the [patch-sqlite-vec.sh](scripts/patch-sqlite-vec.sh) hack.
  2. Generate a 32-byte AES key on first launch; store via **`expo-secure-store`** with
     `WHEN_UNLOCKED_THIS_DEVICE_ONLY` + `requireAuthentication: true`.
  3. Open the DB with that key (`PRAGMA key` / op-sqlite `encryptionKey`).
  4. Add a **recovery path** (biometric re-enrollment invalidates the key) — e.g. a
     passcode-derived backup key.
  5. Privacy hardening: disable analytics/telemetry by default; **verify model download
     SHA-256** before loading; confirm nothing but model downloads leaves the device.
- **Done-check:** the `.sqlite` file is unreadable binary without the key; key access prompts
  biometric; app works in a dev build (not Expo Go).
- **Concepts:** encryption at rest, key management, secure enclave, threat modeling
  ("what does this actually protect against?" — note: a rooted device can still scrape keys
  from memory).

### Phase 3 — Reliable tool calling (the foundation of "doing tasks")
**Concept:** **function calling** = the model emits structured JSON naming a tool + args;
your code runs the tool. Small models are unreliable at this *unless* you **constrain
decoding with a grammar (GBNF / JSON-Schema→grammar)** so invalid output is impossible.
Grammar guarantees *shape*, not *correctness* — you still validate args.

- **Build:**
  1. Define a small **tool registry** with JSON schemas (start with 2–3 tools:
     `add_note`, `search_notes`, `set_reminder`). Use MCP's tool-definition shape as your
     internal convention (don't pull in the full MCP stack yet).
  2. Use llama.rn's `grammar` / `response_format: json_schema` on completions so tool calls
     are always valid JSON.
  3. Keep **intent routing** (you already have it) to pre-select ≤5 relevant tools per turn —
     fewer tools = far fewer wrong-tool hallucinations.
  4. Validate every tool call's args against the schema; on failure, retry **once** with the
     error fed back, then fail gracefully.
- **Done-check:** "remind me to call mom at 6" reliably produces a valid `set_reminder` call;
  malformed output never crashes the loop.
- **Concepts:** function calling, GBNF grammars, JSON-schema-constrained decoding, the
  small-model tool-calling cliff, intent routing.

### Phase 4 — Conversation memory & summarization
**Concept:** the context window is finite (2K–8K tokens). To "remember" long chats you keep
recent turns verbatim + a **rolling summary** of older ones + a **structured fact store**
(SQLite) for must-keep facts. To summarize long docs you use **map-reduce** (summarize
chunks, then summarize the summaries).

- **Build:**
  1. Bump `n_ctx` (you're at 2048 — tight) toward 4K–8K where the model/RAM allow; 2K leaves
     almost no room for system prompt + tools + history.
  2. Context manager: when usage hits ~70% of budget, summarize the oldest turns into the
     rolling summary; keep last ~10 turns verbatim.
  3. Fact store table for high-value facts (names, preferences, recurring tasks), retrieved
     into context at inference time.
  4. A `summarize` tool using map-reduce (≈1000-token chunks) with a progress indicator
     (it's serial and slow on-device — minutes for long docs; foreground-only).
- **Done-check:** a long chat stays coherent past the raw context limit; summarizing a long
  note returns a faithful summary without OOM.
- **Concepts:** context windows, KV cache, rolling summarization + drift, map-reduce, fact
  stores.

### Phase 5 — Agentic task execution (within honest limits)
**Concept:** an **agent loop** = Observe → Think → Act (call tool) → Observe → repeat. On a
phone, pure open-ended ReAct is fragile past a few steps. Use **scripted handlers for known
intents** + ReAct only for open-ended requests, with a **hard iteration cap (5–7)**.

- **Build:**
  1. Device tools via Expo: `expo-calendar` (events/reminders), `expo-notifications`
     (scheduled reminders), `expo-contacts`, web-search-handoff (you already open the
     browser). All require a **dev build**, not Expo Go.
  2. Agent loop with: max-iteration stop, repeated-call detection, per-tool result
     validation, and an action log (write it to the encrypted DB).
  3. Confirmation UX for write actions (creating events, sending things) — the user approves
     before the agent commits.
- **Done-check:** "add a dentist appointment next Tuesday 3pm and remind me the day before"
  creates the right calendar entry + reminder, with a confirmation step, no loops.
- **Concepts:** ReAct, agent loops, tool dispatch, scripted vs. LLM-driven flows, MCP
  schema convention, guardrails.

### Phase 6 — "Autonomous," realistically + polish
**Concept (important reality check):** a phone **cannot** run a local LLM freely in the
background. iOS gives ~30s background slots and **blocks GPU in the background** (GGUF+GPU
crashes); Android needs an intrusive Foreground Service and OEMs kill background work.
**True "runs tasks while in your pocket" autonomy with a local LLM isn't realistic in 2026.**

- **Build / scope honestly:**
  - **Foreground:** full chat, RAG, tool calling, summarization, multi-step tasks. This is
    where "autonomy" lives.
  - **Background (no LLM):** scheduled notification reminders, light sync when charging/WiFi.
    Pure OS scheduler — no inference.
  - **Optional iOS fast-path:** route latency-sensitive calls to Apple Foundation Models on
    iOS 26+ devices, llama.rn everywhere else.
  - Polish: model-manager UX, RAM-aware model suggestions, thermal-aware "burst not
    sustained" generation, onboarding that explains the privacy model.
- **Done-check:** the app is a genuinely useful in-session assistant; background behavior is
  limited to what the OS actually allows, and the UX doesn't over-promise.
- **Concepts:** mobile background-execution limits, foreground services, ANE vs GPU,
  battery/thermal budgets, tiered inference.

---

## 4. Learning checklist (tick as you go)

- [ ] Embeddings, pooling, cosine similarity — *Phase 1*
- [ ] Vector search & RAG; chunking; Matryoshka dims — *Phase 1*
- [ ] Quantization (GGUF, Q4_K_M), model sizing vs RAM — *Phase 2/4*
- [ ] Encryption at rest, secure enclave, key management, threat models — *Phase 2*
- [ ] Prompt templates per model family (you already handle this) — *ongoing*
- [ ] Function calling + GBNF / JSON-schema-constrained decoding — *Phase 3*
- [ ] Context windows, KV cache, rolling summary, map-reduce — *Phase 4*
- [ ] Agent loops (ReAct), guardrails, MCP tool schema — *Phase 5*
- [ ] Mobile background/accel constraints (ANE vs GPU, Doze, BGTask) — *Phase 6*

---

## 5. Honest constraints to keep in mind

- **Background autonomy is the hard ceiling.** Design foreground-first (see Phase 6).
- **Tooling needs a dev build.** SQLCipher, biometrics, calendar, notifications don't work
  in Expo Go.
- **Thermals:** sustained generation throttles 40–60% after ~60–90s. Favor short bursts.
- **Quantized embeddings can degrade silently** — always keep the Phase 1 cosine test.
- **2026 models in this doc are partly blog-sourced** — verify availability/quant before
  committing (your `gemma-4-E4B` entry already points at a real unsloth GGUF, good).
- **`sqlite-vec` is pre-1.0** — pin the version; it's fine for thousands of notes
  (brute-force exact KNN, sub-10ms), not millions.

---

## 6. Immediate next step

**Do Phase 1 first** — specifically the pooling fix + the cosine test. It's small, it
teaches the core RAG concept, and it likely repairs the feature your whole "second brain"
depends on. Everything else builds on real embeddings.

---

## Sources

**Models / edge LLMs**
- Gemma 3n developer guide & MatFormer/PLE: developers.googleblog.com/en/introducing-gemma-3n-developer-guide/ ; ai.google.dev/gemma/docs/gemma-3n ; huggingface.co/blog/rishiraj/matformer-in-gemma-3n
- Qwen3: datacamp.com/blog/qwen3 ; huggingface.co/Qwen/Qwen3-4B-GGUF
- SmolLM3: huggingface.co/blog/smollm3 ; Phi-4-mini: localaimaster.com/models/phi-4-mini
- FunctionGemma (on-device tool calling): blog.google/innovation-and-ai/technology/developers-tools/functiongemma/
- Berkeley Function-Calling Leaderboard: gorilla.cs.berkeley.edu/leaderboard.html
- On-device perf / thermals: arxiv.org/html/2410.03613v3 ; mvpfactory.io/blog/on-device-llm-inference-via-kmp-and-llama-cpp...

**Embeddings / vector search**
- EmbeddingGemma: developers.googleblog.com/en/introducing-embeddinggemma/ ; ai.google.dev/gemma/docs/embeddinggemma/model_card ; arxiv.org/abs/2509.20354 ; huggingface.co/unsloth/embeddinggemma-300m-GGUF
- **Embedding pooling bug:** github.com/mybigday/llama.rn/issues/74 ; github.com/ggml-org/llama.cpp/issues/14543 ; github.com/abetlen/llama-cpp-python/issues/1288 ; software.land/working-with-llama-cpp-embeddings/
- sqlite-vec on RN: github.com/asg017/sqlite-vec ; alexgarcia.xyz/sqlite-vec/android-ios.html
- Chunking: digitalapplied.com/blog/rag-chunking-strategies-2026-retrieval-quality-playbook

**Runtimes**
- llama.rn: github.com/mybigday/llama.rn
- react-native-executorch: github.com/software-mansion/react-native-executorch ; executorch.swmansion.com
- LiteRT-LM: developers.google.com/edge/litert-lm/overview ; react-native-litert-lm: github.com/hung-yueh/react-native-litert-lm
- Apple Foundation Models in RN: react-native-ai.dev ; npmjs.com/package/@react-native-ai/apple ; developer.apple.com/documentation/FoundationModels
- Cactus: github.com/cactus-compute/cactus
- NPU reality: developers.googleblog.com/unlocking-peak-performance-on-qualcomm-npu-with-litert/ ; grapeup.com/blog/running-llms-on-device-with-qualcomm-snapdragon-8-elite

**Agents / secure storage / platform limits**
- Small-model tool-calling cliff: dev.to/.../why-small-llms-fail-at-tool-calling-...
- GBNF grammars: github.com/ggml-org/llama.cpp/blob/master/grammars/README.md
- MCP: modelcontextprotocol.io
- op-sqlite + SQLCipher: op-engineering.github.io/op-sqlite/docs/installation/
- expo-sqlite SQLCipher: docs.expo.dev/versions/latest/sdk/sqlite/
- expo-secure-store: docs.expo.dev/versions/latest/sdk/securestore/
- iOS background GPU crash / tiered inference: medium.com/@nnrajesh3006/the-tiered-inference-strategy-...
- RN background tasks 2026: 72technologies.com/blog/react-native-background-tasks-ios-android-2026
- expo-calendar / notifications: docs.expo.dev/versions/latest/sdk/calendar/ ; .../notifications/
- Map-reduce summarization: f22labs.com/blogs/map-reduce-for-large-document-summarization-with-llms/
Git Repo : https://github.com/Ramanjaneyulu0288/Medha.git