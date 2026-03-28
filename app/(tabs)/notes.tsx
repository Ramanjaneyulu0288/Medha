import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Platform, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
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
      const lastId = insertRes.insertId ?? Math.floor(Math.random() * 100000);
      
      // 3. Insert to notes_vec
      brainStore.db.execute(`INSERT INTO notes_vec (rowid, embedding) VALUES (${Math.floor(Number(lastId))}, ?)`, [f32Array.buffer]);
      
      setInputText('');
      loadNotes(); // Refresh list
    } catch (e: any) {
      alert("Error adding note: " + e.message);
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.tabIconDefault + '40' }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Memories & Tasks</Text>
        <Text style={[styles.headerSubtitle, { color: theme.tabIconDefault }]}>Things Medha remembers</Text>
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
            <View style={[styles.noteCard, { backgroundColor: colorScheme === 'dark' ? '#1A1A2E' : '#F3F4F6', borderColor: theme.tabIconDefault + '30' }]}>
              <Text style={{ color: theme.text, fontSize: 16 }}>{item.content}</Text>
              <Text style={{ color: theme.tabIconDefault, fontSize: 10, marginTop: 8 }}>{item.created_at}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={{ color: theme.tabIconDefault, textAlign: 'center', marginTop: 40 }}>No memories stored yet. Add one below!</Text>}
        />

        <View style={[styles.inputContainer, { borderTopColor: theme.tabIconDefault + '40' }]}>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.tabIconDefault + '60', backgroundColor: colorScheme === 'dark' ? '#1A1A2E' : '#F3F4F6' }]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Add a new note or task..."
            placeholderTextColor={theme.tabIconDefault}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity onPress={handleAddNote} disabled={isAdding || !inputText.trim()} style={[styles.btn, { backgroundColor: theme.tint }]}>
            {isAdding ? <ActivityIndicator size="small" color="#FFF"/> : <Text style={styles.btnText}>Add</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 24, fontWeight: 'bold' },
  headerSubtitle: { fontSize: 14, marginTop: 4 },
  list: { padding: 16, flexGrow: 1, paddingBottom: 40 },
  noteCard: { padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1 },
  inputContainer: { flexDirection: 'row', padding: 12, borderTopWidth: 1, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, marginRight: 10, maxHeight: 100 },
  btn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  btnText: { color: '#FFF', fontWeight: 'bold' }
});
