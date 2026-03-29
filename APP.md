# Medha — App Development Documentation

> **"Your Second Brain, entirely on your phone."**

Medha is a privacy-first, offline AI assistant built with React Native (Expo). It stores memories, vectorizes them locally using a dual-context LLM engine, and uses on-device GGUF models to answer your questions — without any data leaving your phone.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | Expo SDK 54 / React Native 0.81 | Cross-platform mobile app |
| **Database** | Nitro SQLite (`react-native-nitro-sqlite`) | Fast C++/JSI SQLite access |
| **Vector Search** | sqlite-vec (C extension, v0.1.7) | Nearest-neighbor + Keyword Weighting |
| **AI Runtime** | **`llama.rn`** (wrapping `llama.cpp`) | High-performance GGUF inference |
| **Embedding Model** | `all-MiniLM-L6-v2.gguf` | Converts text → 384-dim vectors |
| **Language Model** | `Mistral-7B`, `Phi-3.5`, `Gemma-2B` | Advanced Reasoning & Net-State Math |
| **State** | `BrainStore` Singleton | Shared Model/DB contexts |

---

## Project Structure

```
medha/
├── app/                          # Expo Router pages
│   ├── (tabs)/                   # Tab-based navigation
│   │   ├── index.tsx             # Chat Screen & RAG Logic
│   │   ├── notes.tsx             # Memory Management (Direct Entry)
│   │   ├── models.tsx            # Model Manager (Download/Delete)
│   │   └── _layout.tsx           # Tab configuration
│   └── _layout.tsx               # Root layout
├── utils/
│   └── BrainStore.ts             # Global singleton for DB/Model contexts
├── sqlite-vec/                   # sqlite-vec C source files (v0.1.7)
├── scripts/
│   └── patch-sqlite-vec.sh       # Patches Nitro SQLite at postinstall
├── metro.config.js               # Registers .gguf as asset extension
├── app.json                      # Expo config (New Arch enabled)
└── package.json                  # Dependencies: llama.rn, nitro-sqlite, fs
```

---

## Technical Architecture: "The Local Brain"

Medha uses a **Dual-Context Architecture** to maintain high performance:

1.  **Encoder Context**: A dedicated `llama.rn` instance for the 50MB Embedding model. It stays always-on to vectorize notes and user queries instantly.
2.  **Thinker Context**: A dynamic instance for the large (1.6GB+) Chat model. Shared via `BrainStore` to prevent redundant memory allocation.
3.  **Vector Store**: `sqlite-vec` virtual table (`vec0`) linked to a standard SQLite metadata table.

1. **User Input**: The user sends a message.
2. **Vectorization**: The `Encoder` converts input into a 384-dimension vector.
3. **Hybrid Retrieval**: SQL search combines semantic similarity with exact keyword boosts (+8.0 weight).
4. **Prompt Injection**: Top notes + **Last 3 Chat Messages** are injected into the context.
5. **Generation**: The `Thinker` uses the **Strikeout Method** to audit notes and provide a direct answer.

---

## Key Technical Features

### 1. Dynamic Model Management
Users can download GGUF models directly in-app via `app/(tabs)/models.tsx`. 
- Uses modern **Expo SDK 54 FileSystem API** (`Directory`, `File`).
- Supports resumeable downloads and safe deletion.
- Metro is configured to treat `.gguf` as raw assets to prevent compression.

### 2. sqlite-vec JSI Binding
The C extension is statically linked into `react-native-nitro-sqlite`.
- **RowID Type-Safety**: Fixed binding crashes by inlining IDs as integer literals in SQL strings, bypassing JS `Number` float-binding issues.
- **Agnostic Row Parsing**: Support for various row return formats (`._array`, `.item(i)`) to ensure stability across SQLite versions.

### 3. Inference Control
- **Stream Interruption**: Implemented a "STOP" button that calls `chatContext.stopCompletion()`, immediately halting native inference to save battery/RAM.
- **Memory Management**: Models are shared via the `BrainStore` singleton, ensuring that switching tabs does not trigger a re-load of the 1GB+ GGUF weights.

---

## How to Build & Run

### Prerequisites
- Node.js v20+
- Android device with **6GB+ RAM** (required for 2B+ parameter models)
- **llama.rn** requires a native build via development client.

### Commands
```bash
# 1. Install & Patch
npm install

# 2. Build Native Dev Client
npx expo run:android

# 3. Model Setup
# Open the "Models" tab in the app to download required GGUF files:
# - all-MiniLM-L6-v2.gguf (Embedding)
# - Gemma-2B-7B (Chat)
```

---

## Troubleshooting Reference

| Issue | Cause | Solution |
|---|---|---|
| `Only integers allows for primary key` | JS Numbers are floats in JSI | Use string-interpolated IDs in SQL queries |
| `topNotes.map is not a function` | SQLite row return mismatch | Use the safe array-extractor logic in `index.tsx` |
| App Crash on model load | Out of Memory (OOM) | Ensure device has enough free RAM or use a smaller GGUF |
| Keyboard covering input | Layout layout logic | Use `KeyboardAvoidingView` wrapping the entire `flex: 1` screen |
| Model not found | Incorrect pathing | Verify `Paths.document` is used for downloaded models |

---

## Contributors & Credits
- **Inference**: `llama.rn` (wrapping `llama.cpp`)
- **Database**: `react-native-nitro-sqlite` + `sqlite-vec` (asqlite)
- **Documentation**: Medha Team
