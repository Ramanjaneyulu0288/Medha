import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Platform, KeyboardAvoidingView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { brainStore } from '@/utils/BrainStore';

interface Note {
  id: number;
  content: string;
  created_at: string;
}

export default function NotesScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const theme = Colors[colorScheme];
  const [notes, setNotes] = useState<Note[]>([]);
  const [inputText, setInputText] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    // Refresh notes when screen focuses or periodically if needed
    loadNotes();
    const interval = setInterval(loadNotes, 3000); // Poll DB for updates from Chat screen
    return () => clearInterval(interval);
  }, []);

  function loadNotes() {
    if (!brainStore.db) return;
    try {
      const res = brainStore.db.execute('SELECT * FROM notes ORDER BY id DESC');
      const rows = res.rows;
      let data: Note[] = [];
      if (Array.isArray(rows)) data = rows;
      else if (rows && rows._array) data = rows._array;
      else if (rows && typeof rows.item === 'function') {
        for (let i = 0; i < rows.length; i++) data.push(rows.item(i));
      }
      setNotes(data);
    } catch (e) {
      console.error('List error:', e);
    }
  }

  async function handleAddNote() {
    const text = inputText.trim();
    if (!text || isAdding) return;
    if (!brainStore.db || !brainStore.embedContext) {
      alert("Brain is still initializing. Please open the Chat tab first and wait for models to load.");
      return;
    }

    setIsAdding(true);
    try {
      // 1. Vectorize
      const embedResult = await brainStore.embedContext.embedding(text);
      const f32Array = new Float32Array(embedResult.embedding);
      
      // 2. Insert to notes
      const insertRes = brainStore.db.execute('INSERT INTO notes (content) VALUES (?)', [text]);
      let lastId = insertRes.insertId;
      if (!lastId) {
        const idRes = brainStore.db.execute('SELECT last_insert_rowid() as id');
        lastId = idRes.rows?._array?.[0]?.id || idRes.rows?.item?.(0)?.id || idRes.rows?.[0]?.id;
      }
      
      // 3. Insert to notes_vec (Semantic)
      brainStore.db.execute(`INSERT INTO notes_vec (rowid, embedding) VALUES (${Math.floor(Number(lastId))}, ?)`, [f32Array.buffer]);
      
      setInputText('');
      loadNotes(); // Refresh list
    } catch (e: any) {
      alert("Error adding note: " + e.message);
    } finally {
      setIsAdding(false);
    }
  }

  async function handleSyncVectors() {
    if (!brainStore.db || !brainStore.embedContext || isSyncing) return;
    
    setIsSyncing(true);
    try {
      const res = brainStore.db.execute('SELECT id, content FROM notes WHERE id NOT IN (SELECT rowid FROM notes_vec)');
      let missing: any[] = [];
      const rows = res.rows;
      if (Array.isArray(rows)) missing = rows;
      else if (rows && rows._array) missing = rows._array;
      else if (rows && typeof rows.item === 'function') {
        for (let i = 0; i < rows.length; i++) missing.push(rows.item(i));
      }

      if (missing.length === 0) {
        alert("Brain is already healthy! All memories are vectorized.");
        return;
      }

      setSyncProgress({ current: 0, total: missing.length });

      for (let i = 0; i < missing.length; i++) {
        const item = missing[i];
        setSyncProgress(prev => ({ ...prev, current: i + 1 }));
        const embedResult = await brainStore.embedContext.embedding(item.content);
        const f32Array = new Float32Array(embedResult.embedding);
        
        // Sync vector index
        brainStore.db.execute(`INSERT INTO notes_vec (rowid, embedding) VALUES (${item.id}, ?)`, [f32Array.buffer]);
      }

      alert(`Successfully repaired ${missing.length} memories!`);
    } catch (e: any) {
      alert("Sync error: " + e.message);
    } finally {
      setIsSyncing(false);
      setSyncProgress({ current: 0, total: 0 });
    }
  }

  async function handleDeleteNote(id: number) {
    Alert.alert(
      "Delete Memory?",
      "This will permanently erase this memory from Medha's brain.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive",
          onPress: () => {
            try {
              brainStore.db.execute('DELETE FROM notes WHERE id = ?', [id]);
              brainStore.db.execute('DELETE FROM notes_vec WHERE rowid = ?', [id]);
              loadNotes();
            } catch (err: any) {
              alert("Delete error: " + err.message);
            }
          }
        }
      ]
    );
  }

  async function handleFullReindex() {
    if (!brainStore.db || !brainStore.embedContext || isSyncing) return;
    
    setIsSyncing(true);
    try {
      // 1. Wipe old index
      brainStore.db.execute('DELETE FROM notes_vec');
      
      // 2. Load all notes
      const res = brainStore.db.execute('SELECT id, content FROM notes');
      let all: any[] = [];
      const rows = res.rows;
      if (Array.isArray(rows)) all = rows;
      else if (rows && rows._array) all = rows._array;
      else if (rows && typeof rows.item === 'function') {
        for (let i = 0; i < rows.length; i++) all.push(rows.item(i));
      }

      if (all.length === 0) {
        alert("No memories to re-index!");
        return;
      }

      setSyncProgress({ current: 0, total: all.length });

      // 3. Re-vectorize each one
      for (let i = 0; i < all.length; i++) {
        const item = all[i];
        setSyncProgress(prev => ({ ...prev, current: i + 1 }));
        const embedResult = await brainStore.embedContext.embedding(item.content);
        const f32Array = new Float32Array(embedResult.embedding);
        
        // Sync vector index
        brainStore.db.execute(`INSERT INTO notes_vec (rowid, embedding) VALUES (${item.id}, ?)`, [f32Array.buffer]);
      }

      alert(`Database successfully re-indexed! Medha now knows about all ${all.length} memories.`);
    } catch (e: any) {
      alert("Re-index error: " + e.message);
    } finally {
      setIsSyncing(false);
      setSyncProgress({ current: 0, total: 0 });
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Memories & Tasks</Text>
          <Text style={[styles.headerSubtitle, { color: theme.subtitle }]}>
            {isSyncing ? `Syncing... ${syncProgress.current}/${syncProgress.total}` : 'Things Medha remembers'}
          </Text>
        </View>
        {!isSyncing && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={handleSyncVectors} style={[styles.repairBtn, { borderColor: theme.tint }]}>
              <Text style={{ color: theme.tint, fontWeight: '700', fontSize: 10 }}>QUICK SYNC</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleFullReindex} style={[styles.repairBtn, { borderColor: theme.accent }]}>
              <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 10 }}>FULL RE-INDEX</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          data={notes}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.noteCard, { backgroundColor: theme.assistantBubble, borderColor: theme.border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={{ color: theme.text, fontSize: 16, lineHeight: 24, flex: 1 }}>{item.content}</Text>
                <TouchableOpacity 
                   onPress={() => handleDeleteNote(item.id)}
                   style={{ padding: 4, marginLeft: 8 }}
                >
                  <Text style={{ color: theme.accent, fontSize: 18, fontWeight: '800' }}>×</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ color: theme.subtitle, fontSize: 11, marginTop: 10, fontWeight: '600' }}>{item.created_at}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={{ color: theme.subtitle, textAlign: 'center', marginTop: 60, fontSize: 16 }}>No memories stored yet.{'\n'}Add one below!</Text>}
        />

        <View style={[styles.inputContainer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.assistantBubble }]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Add a new note or task..."
            placeholderTextColor={theme.subtitle}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity 
            onPress={handleAddNote} 
            disabled={isAdding || !inputText.trim()} 
            style={[styles.btn, { backgroundColor: inputText.trim() && !isAdding ? theme.accent : theme.border }]}
          >
            {isAdding ? <ActivityIndicator size="small" color="#FFF"/> : <Text style={styles.btnText}>Add</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { 
    padding: 16, 
    borderBottomWidth: 1,
    paddingTop: Platform.OS === 'android' ? 45 : 16, 
  },
  headerTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 14, marginTop: 2, fontWeight: '500' },
  repairBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    marginLeft: 10,
  },
  list: { padding: 16, flexGrow: 1, paddingBottom: 60 },
  noteCard: { 
    padding: 18, 
    borderRadius: 16, 
    marginBottom: 16, 
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  inputContainer: { 
    flexDirection: 'row', 
    padding: 16, 
    borderTopWidth: 1, 
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 20 : 16, 
  },
  input: { 
    flex: 1, 
    borderWidth: 1, 
    borderRadius: 22, 
    paddingHorizontal: 18, 
    paddingVertical: 12, 
    marginRight: 12, 
    maxHeight: 120,
    fontSize: 16,
  },
  btn: { 
    paddingHorizontal: 22, 
    paddingVertical: 14, 
    borderRadius: 22, 
    justifyContent: 'center', 
    alignItems: 'center',
    elevation: 2,
  },
  btnText: { color: '#FFF', fontWeight: '800', fontSize: 16 }
});
