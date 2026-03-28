#!/bin/bash
# patch-sqlite-vec.sh
# Patches react-native-nitro-sqlite to compile and load sqlite-vec extension.
# Run this after every `npm install`.

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NITRO_DIR="$PROJECT_ROOT/node_modules/react-native-nitro-sqlite"
SQLITE_VEC_SRC="$PROJECT_ROOT/sqlite-vec"

echo "🔧 Patching react-native-nitro-sqlite for sqlite-vec..."

# ── 1. Verify sqlite-vec source files exist ──
if [ ! -f "$SQLITE_VEC_SRC/sqlite-vec.c" ] || [ ! -f "$SQLITE_VEC_SRC/sqlite-vec.h" ]; then
  echo "❌ Error: sqlite-vec.c and sqlite-vec.h not found in $SQLITE_VEC_SRC"
  exit 1
fi

# ── 2. Copy sqlite-vec source into Nitro SQLite's cpp directory ──
mkdir -p "$NITRO_DIR/cpp/sqlite-vec"
cp "$SQLITE_VEC_SRC/sqlite-vec.c" "$NITRO_DIR/cpp/sqlite-vec/"
cp "$SQLITE_VEC_SRC/sqlite-vec.h" "$NITRO_DIR/cpp/sqlite-vec/"
echo "  ✅ Copied sqlite-vec source files"

# ── 3. Patch CMakeLists.txt (Android) ──
CMAKE_FILE="$NITRO_DIR/android/CMakeLists.txt"

if ! grep -q "SQLITE_CORE" "$CMAKE_FILE"; then
  # Add -DSQLITE_CORE to add_definitions
  sed -i.bak 's|${SQLITE_FLAGS}|${SQLITE_FLAGS}\n  -DSQLITE_CORE|' "$CMAKE_FILE"
  echo "  ✅ Added -DSQLITE_CORE to CMakeLists.txt"
else
  echo "  ⏭️  -DSQLITE_CORE already present in CMakeLists.txt"
fi

if ! grep -q "sqlite-vec" "$CMAKE_FILE"; then
  # Add sqlite-vec include directory
  sed -i.bak 's|../cpp/sqlite|../cpp/sqlite\n  ../cpp/sqlite-vec|' "$CMAKE_FILE"
  echo "  ✅ Added sqlite-vec include directory to CMakeLists.txt"
else
  echo "  ⏭️  sqlite-vec include already present in CMakeLists.txt"
fi

# Clean up backup files
rm -f "$CMAKE_FILE.bak"

# ── 4. Patch operations.cpp to include and init sqlite-vec ──
OPS_FILE="$NITRO_DIR/cpp/operations.cpp"

if ! grep -q "sqlite-vec.h" "$OPS_FILE"; then
  # Add #include "sqlite-vec.h" after #include <sqlite3.h>
  sed -i.bak 's|#include <sqlite3.h>|#include <sqlite3.h>\n#include "sqlite-vec.h"|' "$OPS_FILE"
  echo "  ✅ Added sqlite-vec.h include to operations.cpp"
else
  echo "  ⏭️  sqlite-vec.h include already present in operations.cpp"
fi

if ! grep -q "sqlite3_vec_init" "$OPS_FILE"; then
  # Add sqlite3_vec_init() call after successful db open
  sed -i.bak 's|dbMap\[dbName\] = db;|// Register sqlite-vec extension for vector search\n    sqlite3_vec_init(db, nullptr, nullptr);\n    dbMap[dbName] = db;|' "$OPS_FILE"
  echo "  ✅ Added sqlite3_vec_init() call to operations.cpp"
else
  echo "  ⏭️  sqlite3_vec_init() already present in operations.cpp"
fi

# Clean up backup files
rm -f "$OPS_FILE.bak"

echo ""
echo "🎉 sqlite-vec patch applied successfully!"
echo "   You can now run: npx expo run:android"
