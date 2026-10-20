# Medha — your private, on-device AI

Medha is a **fully on-device AI assistant** built with Expo / React Native. It chats,
remembers your notes, and (over time) performs tasks and summarizes — with **all inference
running locally on your phone**. No cloud, no accounts, no data leaving the device.

**How it works**
- **LLM + embeddings:** [`llama.rn`](https://github.com/mybigday/llama.rn) (llama.cpp) running GGUF models you download in-app.
- **Memory (RAG):** notes are embedded into vectors and searched with `sqlite-vec`.
- **Privacy:** your data stays on-device; encryption-at-rest is on the roadmap.

## Run it

```bash
npm install            # also patches sqlite-vec into the native SQLite module (postinstall)
npx expo run:android   # or: npx expo run:ios   (a dev build is required — not Expo Go)
```

Then open the **Models** tab to download an embedding model (all-MiniLM) and a chat model,
and start chatting.

## Roadmap & design

The full build plan, model/runtime research, and the phase-by-phase roadmap live in
**[PLAN.md](PLAN.md)**. Deeper architecture notes are in
[RAG_TECHNICAL_GUIDE.md](RAG_TECHNICAL_GUIDE.md).

## Project layout

| Path | What |
|---|---|
| `app/(tabs)/index.tsx` | Chat screen + RAG pipeline + model init |
| `app/(tabs)/notes.tsx` | Notes ("memories") CRUD + re-indexing |
| `app/(tabs)/models.tsx` | Download / activate local models |
| `utils/embeddings.ts` | Embedding + cosine-similarity helpers + self-test |
| `utils/db.ts` | SQLite result-row normalization helpers |
| `utils/Router.ts` | Keyword intent fast-path router |
| `utils/BrainStore.ts` | Singleton holding the loaded contexts + db |
| `scripts/patch-sqlite-vec.sh` | Statically links `sqlite-vec` into the native SQLite module |
