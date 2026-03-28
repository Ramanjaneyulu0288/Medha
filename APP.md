# Medha — App Development Documentation

> **"Your Second Brain, entirely on your phone."**

Medha is a privacy-first, offline AI assistant built with React Native (Expo). It stores notes, vectorizes them locally, and uses on-device LLMs to answer your questions — without any data leaving your phone.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | Expo SDK 54 / React Native 0.81 | Cross-platform mobile app |
| **Database** | Nitro SQLite (`react-native-nitro-sqlite`) | Fast C++/JSI SQLite access (no bridge overhead) |
| **Vector Search** | sqlite-vec (C extension, v0.1.7) | Nearest-neighbor search on embedding vectors |
| **AI Runtime** | LiteRT via `react-native-fast-tflite` | On-device model inference |
| **Embedding Model** | all-MiniLM-L6-v2 (quantized, `.tflite`) | Converts text → 384-dim vectors |
| **Language Model** | Gemma 2B IT (int4, `.bin`) | Generates natural language answers |
| **Navigation** | Expo Router + React Navigation | File-based routing |

---

## Project Structure

```
medha/
├── app/                          # Expo Router pages
│   ├── (tabs)/                   # Tab-based navigation
│   ├── _layout.tsx               # Root layout
│   └── modal.tsx                 # Modal screen
├── assets/
│   ├── images/                   # App icons, splash screen
│   └── models/                   # AI model files (.tflite / .bin)
│       ├── all-MiniLM-L6-v2-quant.tflite
│       └── gemma-2b-it-cpu-int4.bin
├── sqlite-vec/                   # sqlite-vec C source files
│   ├── sqlite-vec.c              # Main extension source (10K lines)
│   └── sqlite-vec.h              # Header with sqlite3_vec_init()
├── scripts/
│   └── patch-sqlite-vec.sh       # Patches Nitro SQLite at postinstall
├── metro.config.js               # Registers .tflite as asset extension
├── app.json                      # Expo config (plugins, package name)
├── package.json                  # Dependencies + postinstall hook
└── TechDoc.md                    # Architecture design ("Local Brain" workflow)
```

---

## What Has Been Set Up

### 1. Android Build Configuration

- Added `android.package` (`com.anonymous.medha`) to `app.json` — required for `expo run:android`
- Node.js upgraded to v20+ (required by React Native 0.81 / Metro 0.83)

### 2. sqlite-vec Integration (Vector Search)

sqlite-vec is a pure-C SQLite extension that adds virtual tables for vector similarity search.

**How it works:**
- Source files (`sqlite-vec.c`, `sqlite-vec.h`) are at `sqlite-vec/` in the project root
- A patch script (`scripts/patch-sqlite-vec.sh`) copies them into Nitro SQLite's native build tree at `node_modules/react-native-nitro-sqlite/cpp/sqlite-vec/`
- The patch also:
  - Adds `-DSQLITE_CORE` compile flag to `CMakeLists.txt`
  - Adds `sqlite-vec/` to CMake include directories
  - Hooks `sqlite3_vec_init(db, nullptr, nullptr)` in `operations.cpp` after every `sqlite3_open_v2()` call
- The patch runs automatically via `postinstall` in `package.json`

**Key SQL functions available after patching:**
```sql
SELECT vec_version();                    -- Returns "v0.1.7"
CREATE VIRTUAL TABLE notes_vec USING vec0(embedding float[384]);
SELECT * FROM notes_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 5;
```

### 3. LiteRT (TensorFlow Lite) Configuration

- **`metro.config.js`** — Registers `.tflite` as an asset extension so Metro bundles model files as raw binary data (no compression)
- **`app.json`** — Added `expo-asset` plugin to include model files in the native build:
  - `./assets/models/all-MiniLM-L6-v2-quant.tflite` (embedding model)
  - `./assets/models/gemma-2b-it-cpu-int4.bin` (language model)
- **`react-native-fast-tflite`** — Already installed and listed as an Expo plugin
- **`.gitignore`** — Added `*.tflite` to exclude large model files from git

---

## How to Build & Run

### Prerequisites
- Node.js v20+ (`node -v` to check)
- Android device connected via ADB (`adb devices` to verify)
- Model files placed in `assets/models/`

### Commands
```bash
# 1. Install dependencies (also runs sqlite-vec patch via postinstall)
npm install

# 2. Build & install on Android device
npx expo run:android

# 3. Start Metro dev server (for subsequent runs after initial build)
npx expo start
# Then press 'a' to open on Android
```

### After `npm install` (if patch didn't auto-run)
```bash
bash scripts/patch-sqlite-vec.sh
```

---

## How to Test Everything

### Test 1: App Launches Without Crashing
After building with `npx expo run:android`, the app should open on your device without any crash. This confirms:
- ✅ Expo build pipeline is working
- ✅ Native modules (Nitro SQLite, Fast TFLite) compiled correctly
- ✅ sqlite-vec C extension compiled without errors

### Test 2: Verify sqlite-vec is Loaded
Create a temporary test file or add this to an existing screen:

```typescript
// Example: app/(tabs)/index.tsx — add inside the component
import { NitroSQLite } from 'react-native-nitro-sqlite';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

export default function HomeScreen() {
  const [vecVersion, setVecVersion] = useState<string>('loading...');

  useEffect(() => {
    try {
      const db = NitroSQLite.open({ name: 'test_vec.db' });
      const result = db.execute('SELECT vec_version() as version');
      const version = result.rows?.[0]?.version ?? 'unknown';
      setVecVersion(version);
      db.close();
    } catch (e: any) {
      setVecVersion('ERROR: ' + e.message);
    }
  }, []);

  return <Text>sqlite-vec version: {vecVersion}</Text>;
}
```

**Expected result:** Displays `sqlite-vec version: v0.1.7`

### Test 3: Verify LiteRT Model Loading
```typescript
import { useTensorflowModel } from 'react-native-fast-tflite';

// Inside a component
const embeddingModel = useTensorflowModel(
  require('../../assets/models/all-MiniLM-L6-v2-quant.tflite')
);

if (embeddingModel.state === 'loaded') {
  console.log('✅ Embedding model loaded successfully');
} else if (embeddingModel.state === 'error') {
  console.log('❌ Model load error:', embeddingModel.error);
} else {
  console.log('⏳ Loading model...');
}
```

**Expected result:** Console shows `✅ Embedding model loaded successfully`

### Test 4: End-to-End Vector Storage
```typescript
const db = NitroSQLite.open({ name: 'medha_brain.db' });

// Create vector table (384 dimensions for MiniLM)
db.execute(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_vec USING vec0(embedding float[384])`);

// Insert a dummy vector (384 zeros for testing)
const dummyVec = new Float32Array(384).fill(0.1);
db.execute('INSERT INTO notes_vec(rowid, embedding) VALUES (?, ?)', [
  1,
  dummyVec.buffer
]);

// Query nearest neighbors
const results = db.execute(
  'SELECT rowid, distance FROM notes_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 3',
  [dummyVec.buffer]
);
console.log('Vector search results:', results.rows);
```

**Expected result:** Returns rowid 1 with distance 0.0

---

## Architecture: "The Local Brain" Workflow

```
User types a note
       │
       ▼
┌──────────────────┐
│ Embedding Model  │  all-MiniLM-L6-v2 (LiteRT)
│ Text → Vector    │  Converts text to 384-dim float vector
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Nitro SQLite     │  sqlite-vec virtual table
│ + sqlite-vec     │  Stores vectors with note IDs
└──────┬───────────┘
       │
       ▼  (User asks a question)
┌──────────────────┐
│ Vector Search    │  KNN search via sqlite-vec
│ (Retrieval)      │  Finds top-K most relevant notes
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Gemma 2B (LiteRT)│  Reads retrieved notes + question
│ (Generation)     │  Produces a natural language answer
└──────────────────┘
```

---

## Troubleshooting

| Issue | Solution |
|---|---|
| `configs.toReversed is not a function` | Upgrade Node.js to v20+ |
| `Required property 'android.package'` | Already added to `app.json` |
| `Operation not permitted` on `node_modules` | Run commands from your own terminal, not the IDE agent terminal |
| Model load error | Check `metro.config.js` has `.tflite` in `assetExts`, clear cache with `npx expo start -c` |
| `sqlite3_vec_init` undefined | Run `bash scripts/patch-sqlite-vec.sh` before building |
| Memory issues with Gemma 2B | Use a device with 6GB+ RAM; the int4 quantized version reduces memory usage |

---

## Key Files Reference

| File | Purpose |
|---|---|
| `app.json` | Expo config: plugins, package name, model assets |
| `metro.config.js` | Registers `.tflite` as raw asset |
| `package.json` | Dependencies + `postinstall` hook for sqlite-vec |
| `scripts/patch-sqlite-vec.sh` | Patches Nitro SQLite with sqlite-vec at install time |
| `sqlite-vec/sqlite-vec.c` | sqlite-vec C source (amalgamation, v0.1.7) |
| `sqlite-vec/sqlite-vec.h` | sqlite-vec header (exposes `sqlite3_vec_init()`) |
| `TechDoc.md` | Architecture design document |
