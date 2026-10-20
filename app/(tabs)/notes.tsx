import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
  InteractionManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { brainStore } from '@/utils/BrainStore';
import { getInsertId, readRows } from '@/utils/db';
import { embedText } from '@/utils/embeddings';
import { recordLedgerFromNote, syncLedgerFromNotes } from '@/utils/ledgerEngine';

interface Note {
  id: number;
  content: string;
  media_type?: string;
  media_uri?: string;
  created_at: string;
  direction?: 'GAVE' | 'RECEIVED';
  amount?: number;
  ledger_person?: string;
}

export default function NotesScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const theme = Colors[colorScheme];
  const [notes, setNotes] = useState<Note[]>([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });

  // Load notes after tab transitions complete (never block tab animation)
  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        loadNotes();
      });
      return () => task.cancel();
    }, [])
  );

  function loadNotes() {
    if (!brainStore.db) return;
    try {
      const res = brainStore.db.execute(`
        SELECT 
          notes.*, 
          ledger.direction, 
          ledger.amount, 
          ledger.original_name as ledger_person 
        FROM notes 
        LEFT JOIN ledger ON ledger.note_id = notes.id 
        ORDER BY notes.id DESC
      `);
      setNotes(readRows<Note>(res));
    } catch (e) {
      console.error('List error:', e);
    }
  }

  async function handleAddNote() {
    const text = inputText.trim();
    if (!text || isAdding) return;
    if (!brainStore.db || !brainStore.embedContext) {
      Alert.alert(
        'Initializing Brain',
        'Please open the Chat tab first and wait for models to finish loading.'
      );
      return;
    }

    setIsAdding(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // 1. Vectorize with Nomic 'search_document:' task prefix
      const f32Array = await embedText(brainStore.embedContext, text, 'document');

      // 2. Insert to notes
      const insertRes = brainStore.db.execute(
        'INSERT INTO notes (content, media_type) VALUES (?, ?)',
        [text, 'text']
      );
      const lastId = getInsertId(insertRes, brainStore.db);
      if (lastId == null) throw new Error('Could not resolve inserted note id');

      // 3. Insert to notes_vec (Semantic 768-dim)
      brainStore.db.execute(
        `INSERT INTO notes_vec (rowid, embedding) VALUES (${Math.floor(Number(lastId))}, ?)`,
        [f32Array.buffer]
      );

      // 4. Extract and record financial transaction (if present)
      await recordLedgerFromNote(brainStore.db, Number(lastId), text, null);

      setInputText('');
      loadNotes();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Error adding note', e.message);
    } finally {
      setIsAdding(false);
    }
  }

  async function handleSyncVectors() {
    if (!brainStore.db || !brainStore.embedContext || isSyncing) return;

    setIsSyncing(true);
    try {
      // 1. Sync missing vectors
      const res = brainStore.db.execute(
        'SELECT id, content FROM notes WHERE id NOT IN (SELECT rowid FROM notes_vec)'
      );
      const missing = readRows<{ id: number; content: string }>(res);

      if (missing.length > 0) {
        setSyncProgress({ current: 0, total: missing.length });
        for (let i = 0; i < missing.length; i++) {
          const item = missing[i];
          setSyncProgress((prev) => ({ ...prev, current: i + 1 }));
          const f32Array = await embedText(brainStore.embedContext, item.content, 'document');

          brainStore.db.execute(
            `INSERT INTO notes_vec (rowid, embedding) VALUES (${Math.floor(Number(item.id))}, ?)`,
            [f32Array.buffer]
          );
        }
      }

      // 2. Sync missing financial transactions into ledger
      const syncedTxCount = await syncLedgerFromNotes(brainStore.db);

      Alert.alert(
        'Brain Sync Complete',
        `Indexed ${missing.length} missing vectors and synced ${syncedTxCount} financial ledger entries!`
      );
    } catch (e: any) {
      Alert.alert('Sync Error', e.message);
    } finally {
      setIsSyncing(false);
      setSyncProgress({ current: 0, total: 0 });
    }
  }

  async function handleDeleteNote(id: number) {
    Alert.alert(
      'Delete Memory?',
      'This will erase this memory permanently from Medha.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              brainStore.db.execute('DELETE FROM ledger WHERE note_id = ?', [id]);
              brainStore.db.execute('DELETE FROM notes_vec WHERE rowid = ?', [id]);
              brainStore.db.execute('DELETE FROM notes WHERE id = ?', [id]);
              loadNotes();
            } catch (err: any) {
              Alert.alert('Delete error', err.message);
            }
          },
        },
      ]
    );
  }

  async function handleFullReindex() {
    if (!brainStore.db || !brainStore.embedContext || isSyncing) return;

    setIsSyncing(true);
    try {
      brainStore.db.execute('DELETE FROM notes_vec');
      brainStore.db.execute('DELETE FROM ledger');

      const res = brainStore.db.execute('SELECT id, content FROM notes');
      const all = readRows<{ id: number; content: string }>(res);

      if (all.length === 0) {
        Alert.alert('Empty', 'No memories to re-index.');
        return;
      }

      setSyncProgress({ current: 0, total: all.length });

      for (let i = 0; i < all.length; i++) {
        const item = all[i];
        setSyncProgress((prev) => ({ ...prev, current: i + 1 }));
        const f32Array = await embedText(brainStore.embedContext, item.content, 'document');
        brainStore.db.execute(
          `INSERT INTO notes_vec (rowid, embedding) VALUES (${Math.floor(Number(item.id))}, ?)`,
          [f32Array.buffer]
        );
      }

      // Also rebuild ledger records
      const syncedTxCount = await syncLedgerFromNotes(brainStore.db);
      loadNotes();

      Alert.alert(
        'Re-index Finished',
        `Rebuilt vector index for ${all.length} memories and synced ${syncedTxCount} ledger transactions!`
      );
    } catch (e: any) {
      Alert.alert('Re-index error', e.message);
    } finally {
      setIsSyncing(false);
      setSyncProgress({ current: 0, total: 0 });
    }
  }

  const filteredNotes = searchQuery.trim()
    ? notes.filter((n) => n.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : notes;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Memories</Text>
            <Text style={[styles.headerSubtitle, { color: theme.subtitle }]}>
              {isSyncing
                ? `Indexing ${syncProgress.current}/${syncProgress.total}...`
                : `${notes.length} ${notes.length === 1 ? 'memory' : 'memories'} saved`}
            </Text>
          </View>
          {!isSyncing && (
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={handleSyncVectors}
                style={[styles.actionBtn, { borderColor: theme.tint + '50', backgroundColor: theme.tint + '10' }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.actionBtnText, { color: theme.tint }]}>SYNC</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleFullReindex}
                style={[styles.actionBtn, { borderColor: theme.accent + '50', backgroundColor: theme.accent + '10' }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.actionBtnText, { color: theme.accent }]}>RE-INDEX</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Quick Search */}
        {notes.length > 2 && (
          <View
            style={[
              styles.searchBar,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={{ fontSize: 13, marginRight: 8, color: theme.subtitle }}>🔍</Text>
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Filter memories..."
              placeholderTextColor={theme.subtitle}
              clearButtonMode="while-editing"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Text style={{ color: theme.subtitle, fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          data={filteredNotes}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View
              style={[
                styles.noteCard,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.noteContent, { color: theme.text }]}>{item.content}</Text>
                <TouchableOpacity
                  onPress={() => handleDeleteNote(item.id)}
                  style={styles.deleteBtn}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={[styles.deleteBtnText, { color: theme.error }]}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.cardFooter}>
                <Text style={[styles.dateText, { color: theme.subtitle }]}>
                  {new Date(item.created_at).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {item.ledger_person && item.amount ? (
                    <View
                      style={[
                        styles.chip,
                        {
                          backgroundColor:
                            item.direction === 'GAVE' ? theme.accent + '20' : theme.success + '20',
                          borderColor:
                            item.direction === 'GAVE' ? theme.accent : theme.success,
                          borderWidth: StyleSheet.hairlineWidth,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color:
                              item.direction === 'GAVE' ? theme.accent : theme.success,
                            fontWeight: '600',
                          },
                        ]}
                      >
                        {item.direction === 'GAVE'
                          ? `💳 Lent ₹${item.amount} to ${item.ledger_person}`
                          : `💳 Received ₹${item.amount} from ${item.ledger_person}`}
                      </Text>
                    </View>
                  ) : null}
                  <View style={[styles.chip, { backgroundColor: theme.accent + '15' }]}>
                    <Text style={[styles.chipText, { color: theme.accent }]}>768d Vector</Text>
                  </View>
                </View>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>💡</Text>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                {searchQuery ? 'No matching memories' : 'No memories stored yet'}
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.subtitle }]}>
                {searchQuery
                  ? 'Try a different search term'
                  : 'Write anything below and Medha will remember it forever.'}
              </Text>
            </View>
          }
        />

        <View
          style={[
            styles.inputContainer,
            { borderTopColor: theme.border, backgroundColor: theme.background },
          ]}
        >
          <TextInput
            style={[
              styles.input,
              {
                color: theme.text,
                borderColor: theme.border,
                backgroundColor: theme.surface,
              },
            ]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Remember something new..."
            placeholderTextColor={theme.subtitle}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity
            onPress={handleAddNote}
            disabled={isAdding || !inputText.trim()}
            style={[
              styles.btn,
              {
                backgroundColor:
                  inputText.trim() && !isAdding ? theme.accent : theme.border,
              },
            ]}
            activeOpacity={0.8}
          >
            {isAdding ? (
              <ActivityIndicator size="small" color={theme.userBubbleText} />
            ) : (
              <Text style={[styles.btnText, { color: inputText.trim() && !isAdding ? theme.userBubbleText : theme.subtitle }]}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    paddingTop: Platform.OS === 'android' ? 40 : 12,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  headerSubtitle: { fontSize: 13, marginTop: 2, fontWeight: '500' },
  headerActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  actionBtnText: { fontWeight: '700', fontSize: 11, letterSpacing: 0.5 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 2 },
  list: { padding: 20, flexGrow: 1, paddingBottom: 60 },
  noteCard: {
    padding: 16,
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  noteContent: { fontSize: 15, lineHeight: 22, flex: 1, fontWeight: '400' },
  deleteBtn: { padding: 4, marginLeft: 8 },
  deleteBtnText: { fontSize: 16, fontWeight: '700' },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  dateText: { fontSize: 11, fontWeight: '500' },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  chipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: 32,
  },
  emptyEmoji: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginRight: 12,
    maxHeight: 120,
    fontSize: 15,
  },
  btn: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  btnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
});
