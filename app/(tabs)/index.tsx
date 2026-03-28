import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { Directory, Paths, File } from 'expo-file-system/next';
import { initLlama, LlamaContext } from 'llama.rn';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { brainStore } from '@/utils/BrainStore';

// ── Types ──
type MessageRole = 'user' | 'assistant' | 'system';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
}

interface SystemStatus {
  sqliteVec: 'loading' | 'ready' | 'error';
  sqliteVecVersion: string;
  embeddingModel: 'loading' | 'ready' | 'error' | 'not_found';
  embeddingModelInfo: string;
  chatModel: 'loading' | 'ready' | 'error' | 'not_found' | 'none_selected';
  chatModelInfo: string;
}

// ── Theme Colors ──
const COLORS = {
  dark: {
    bg: '#0D0D0D',
    surface: '#1A1A2E',
    surfaceLight: '#252540',
    accent: '#7C3AED',
    accentLight: '#8B5CF6',
    userBubble: '#7C3AED',
    assistantBubble: '#1E1E38',
    text: '#F1F1F6',
    textSecondary: '#9CA3AF',
    textMuted: '#6B7280',
    border: '#2D2D4A',
    success: '#10B981',
    error: '#EF4444',
    warning: '#F59E0B',
    inputBg: '#1A1A2E',
  },
  light: {
    bg: '#FAFAFE',
    surface: '#FFFFFF',
    surfaceLight: '#F3F4F6',
    accent: '#7C3AED',
    accentLight: '#8B5CF6',
    userBubble: '#7C3AED',
    assistantBubble: '#F3F4F6',
    text: '#111827',
    textSecondary: '#6B7280',
    textMuted: '#9CA3AF',
    border: '#E5E7EB',
    success: '#10B981',
    error: '#EF4444',
    warning: '#F59E0B',
    inputBg: '#F3F4F6',
  },
};

// ── Status Badge ──
function StatusBadge({ status, label }: { status: string; label: string }) {
  const colorScheme = useColorScheme() ?? 'dark';
  const theme = COLORS[colorScheme];
  const color =
    status === 'ready'
      ? theme.success
      : status === 'loading'
        ? theme.warning
        : theme.error;

  return (
    <View style={[styles.badge, { backgroundColor: color + '20', borderColor: color + '40' }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

// ── Chat Bubble ──
function ChatBubble({ message, theme }: { message: ChatMessage; theme: typeof COLORS.dark }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <View style={styles.systemMsgContainer}>
        <Text
          selectable={true}
          style={[styles.systemMsgText, { color: theme.textMuted }]}
        >
          {message.content}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.bubbleRow,
        isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant,
      ]}
    >
      {!isUser && (
        <View style={[styles.avatar, { backgroundColor: theme.accent }]}>
          <Text style={styles.avatarText}>M</Text>
        </View>
      )}
      <View
        style={[
          styles.bubble,
          isUser
            ? [styles.userBubble, { backgroundColor: theme.userBubble }]
            : [styles.assistantBubble, { backgroundColor: theme.assistantBubble }],
        ]}
      >
        <Text
          selectable={true}
          style={[
            styles.bubbleText,
            { color: isUser ? '#FFFFFF' : theme.text },
          ]}
        >
          {message.content}
        </Text>
        <Text
          style={[
            styles.timestamp,
            { color: isUser ? 'rgba(255,255,255,0.5)' : theme.textMuted },
          ]}
        >
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </View>
  );
}

// ── Main Screen ──
export default function ChatScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const theme = COLORS[colorScheme];

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [status, setStatus] = useState<SystemStatus>({
    sqliteVec: 'loading',
    sqliteVecVersion: '',
    embeddingModel: 'loading',
    embeddingModelInfo: '',
    chatModel: 'loading',
    chatModelInfo: '',
  });

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const embedContextRef = useRef<LlamaContext | null>(null);
  const chatContextRef = useRef<LlamaContext | null>(null);
  // Store db globally for RAG
  const dbRef = useRef<any>(null);

  // ── System message helper ──
  const addSystemMessage = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString() + Math.random(),
        role: 'system',
        content,
        timestamp: new Date(),
      },
    ]);
  }, []);

  // ── Initialize systems on mount ──
  useEffect(() => {
    initializeSystems();
  }, []);

  async function initializeSystems() {
    addSystemMessage('🧠 Initializing Medha...');

    // Test 1: sqlite-vec
    await testSqliteVec();

    // Test 2: llama.rn models
    await loadLlamaContexts();

    addSystemMessage('✨ Medha is ready. Ask me anything about your notes!');
  }

  async function testSqliteVec() {
    try {
      addSystemMessage('📦 Loading sqlite-vec...');
      const { NitroSQLite } = require('react-native-nitro-sqlite');

      let db: any;
      try {
        db = NitroSQLite.open({ name: 'medha_brain.db' });
      } catch (e: any) {
        if (e.message.includes('already open')) {
          // On fast refresh, the DB might already be open in the native module.
          // We can just use the global execute function directly.
          db = {
            execute: (query: string, params?: any[]) =>
              NitroSQLite.execute('medha_brain.db', query, params),
          };
        } else {
          throw e;
        }
      }

      // Test vec_version()
      const result = db.execute('SELECT vec_version() as version');
      const version = result.rows?.[0]?.version ?? 'unknown';

      // Create the vector table if it doesn't exist
      db.execute(
        'CREATE VIRTUAL TABLE IF NOT EXISTS notes_vec USING vec0(embedding float[384])'
      );

      // Create notes metadata table
      db.execute(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      setStatus((prev) => ({
        ...prev,
        sqliteVec: 'ready',
        sqliteVecVersion: version,
      }));
      dbRef.current = db;
      brainStore.db = db;
      addSystemMessage(`✅ sqlite-vec ${version} loaded. Vector database ready.`);
    } catch (e: any) {
      setStatus((prev) => ({
        ...prev,
        sqliteVec: 'error',
        sqliteVecVersion: e.message,
      }));
      console.error('SQLITE-VEC ERROR:', e);
      addSystemMessage(`❌ sqlite-vec error: ${e.message}`);
    }
  }

  async function loadLlamaContexts() {
    try {
      addSystemMessage('🤖 Scanning downloaded models...');
      setStatus((prev) => ({ ...prev, embeddingModel: 'loading', chatModel: 'loading' }));

      // Find downloaded models
      const dir = new Directory(Paths.document);
      const contents = dir.list();
      const files = contents.map(item => item.name).filter(f => f.endsWith('.gguf'));
      
      const embedModelFile = files.find(f => f.includes('MiniLM'));
      const chatModels = files.filter(f => !f.includes('MiniLM'));

      setAvailableModels(chatModels);

      // Load Embedding Context
      if (embedModelFile) {
        addSystemMessage('📦 Loading Vector Engine into memory...');
        embedContextRef.current = await initLlama({
          model: new File(Paths.document, embedModelFile).uri,
          embedding: true,
          use_mlock: true,
        });
        brainStore.embedContext = embedContextRef.current;
        setStatus(p => ({ ...p, embeddingModel: 'ready', embeddingModelInfo: embedModelFile }));
        addSystemMessage('✅ Vector Engine initialized.');
      } else {
        setStatus(p => ({ ...p, embeddingModel: 'not_found', embeddingModelInfo: 'Missing MiniLM' }));
        addSystemMessage('⚠️ Missing embedding model. Please download it in the Models tab.');
      }

      // Auto-select first chat model if available
      if (chatModels.length > 0) {
        setSelectedModel(chatModels[0]);
      } else {
        setStatus(p => ({ ...p, chatModel: 'not_found', chatModelInfo: 'No chat model downloaded' }));
        addSystemMessage('⚠️ No chat model found. Please download one in the Models tab.');
      }
    } catch (e: any) {
      console.error('LLAMA.RN MODEL ERROR:', e);
      addSystemMessage(`⚠️ llama.rn Error: ${e.message}`);
      setStatus(p => ({ ...p, embeddingModel: 'error', chatModel: 'error' }));
    }
  }

  // Reload Chat Context when selectedModel changes
  useEffect(() => {
    if (!selectedModel) return;
    let isMounted = true;

    async function loadChat() {
      try {
        if (chatContextRef.current) {
          await chatContextRef.current.release();
          chatContextRef.current = null;
        }
        if (!isMounted) return;

        setStatus(p => ({ ...p, chatModel: 'loading' }));
        addSystemMessage(`🧠 Loading ${selectedModel} (this may take a moment)...`);
        
        const context = await initLlama({
          model: new File(Paths.document, selectedModel!).uri,
          n_gpu_layers: 99,
          use_mlock: true,
          n_ctx: 2048,
        });

        if (!isMounted) {
          context.release();
          return;
        }

        chatContextRef.current = context;
        setStatus(p => ({ ...p, chatModel: 'ready', chatModelInfo: selectedModel! }));
        addSystemMessage(`✅ Thinker model loaded and ready!`);
      } catch(e: any) {
        if (!isMounted) return;
        setStatus(p => ({ ...p, chatModel: 'error', chatModelInfo: e.message }));
        addSystemMessage(`⚠️ Failed to load chat model: ${e.message}`);
      }
    }
    loadChat();

    return () => {
      isMounted = false;
    };
  }, [selectedModel]);

  // ── Send message ──
  async function handleSend() {
    const text = inputText.trim();
    if (!text || isThinking) return;

    if (!embedContextRef.current || !chatContextRef.current || status.sqliteVec !== 'ready') {
      addSystemMessage("⚠️ Systems are still booting up. Please wait.");
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsThinking(true);

    try {
      // 1. Slash command for adding a note to the Brain
      if (text.toLowerCase().startsWith('/note ')) {
        const noteContent = text.slice(6).trim();
        const embedResult = await embedContextRef.current.embedding(noteContent);
        
        const f32Array = new Float32Array(embedResult.embedding);
        const buffer = new Uint8Array(f32Array.buffer);
        
        const insertRes = dbRef.current.execute('INSERT INTO notes (content) VALUES (?)', [noteContent]);
        const lastId = insertRes.insertId ?? Math.floor(Math.random() * 100000); // Fallback if insertId is missing
        
        dbRef.current.execute(`INSERT INTO notes_vec (rowid, embedding) VALUES (${Math.floor(Number(lastId))}, ?)`, [f32Array.buffer]);
        
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'assistant', content: '✅ Note saved and vectorized!', timestamp: new Date() }
        ]);
        setIsThinking(false);
        return;
      }

      // 2. Vectorize the User Query
      const embedResult = await embedContextRef.current.embedding(text);
      const f32Array = new Float32Array(embedResult.embedding);
      const buffer = new Uint8Array(f32Array.buffer);

      // 3. Search Database
      const searchRes = dbRef.current.execute(
        `
        SELECT notes.content, notes_vec.distance
        FROM notes_vec
        JOIN notes ON notes.id = notes_vec.rowid
        WHERE embedding MATCH ? AND k = 3
        ORDER BY distance
        `,
        [f32Array.buffer]
      );

      let contextStr = '';
      let topNotes: any[] = [];
      if (searchRes.rows) {
        if (Array.isArray(searchRes.rows)) topNotes = searchRes.rows;
        else if (searchRes.rows._array) topNotes = searchRes.rows._array;
        else if (typeof searchRes.rows.item === 'function') {
          for (let i = 0; i < searchRes.rows.length; i++) topNotes.push(searchRes.rows.item(i));
        }
      }
      if (topNotes.length > 0) {
        contextStr = 'RELEVANT NOTES:\n' + topNotes.map((n: any) => `- ${n.content}`).join('\n') + '\n\n';
      }

      // 4. Construct Prompt
      const prompt = `<start_of_turn>user\n${contextStr}${text}<end_of_turn>\n<start_of_turn>model\n`;

      const responseId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        { id: responseId, role: 'assistant', content: '', timestamp: new Date() },
      ]);

      // 5. Stream Tokens
      await chatContextRef.current.completion(
        { prompt, n_predict: 256, temperature: 0.7 },
        (res) => {
          setMessages((prev) => 
            prev.map((msg) => 
              msg.id === responseId ? { ...msg, content: msg.content + res.token } : msg
            )
          );
        }
      );

    } catch (e: any) {
      console.error('Inference Error:', e);
      addSystemMessage(`❌ Generation error: ${e.message}`);
    } finally {
      setIsThinking(false);
    }
  }

  // ── Auto-scroll to bottom ──
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  // ── Render ──
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.headerIcon, { backgroundColor: theme.accent }]}>
            <Text style={styles.headerIconText}>M</Text>
          </View>
          <View>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Medha</Text>
            <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
              Your Second Brain
            </Text>
          </View>
        </View>
        <View style={styles.headerBadges}>
          <StatusBadge
            status={status.sqliteVec}
            label={status.sqliteVec === 'ready' ? 'Vec DB' : 'Vec !'}
          />
          <StatusBadge
            status={status.embeddingModel}
            label={status.embeddingModel === 'ready' ? 'Encoder' : 'Enc !'}
          />
           <StatusBadge
            status={status.chatModel}
            label={status.chatModel === 'ready' ? 'Thinker' : 'Think !'}
          />
        </View>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ChatBubble message={item} theme={theme} />}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={[styles.emptyIcon]}>🧠</Text>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                Welcome to Medha
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                Your private, on-device AI assistant.{'\n'}
                Initializing systems...
              </Text>
            </View>
          }
        />

        {/* Thinking Indicator */}
        {isThinking && (
          <View style={[styles.thinkingBar, { backgroundColor: theme.surface }]}>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text style={[styles.thinkingText, { color: theme.textSecondary }]}>
              Medha is thinking...
            </Text>
          </View>
        )}

        <View style={[styles.inputContainer, { borderTopColor: theme.border }]}>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: theme.inputBg,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask Medha anything..."
            placeholderTextColor={theme.textMuted}
            multiline
            maxLength={2000}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!inputText.trim() || isThinking}
            style={[
              styles.sendButton,
              {
                backgroundColor:
                  inputText.trim() && !isThinking ? theme.accent : theme.surfaceLight,
              },
            ]}
          >
            <Text
              style={[
                styles.sendButtonText,
                {
                  color:
                    inputText.trim() && !isThinking ? '#FFFFFF' : theme.textMuted,
                },
              ]}
            >
              ↑
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ──
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: Platform.OS === 'android' ? 40 : 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  headerBadges: {
    flexDirection: 'row',
    gap: 6,
  },

  // Status Badge
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },

  // Messages
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexGrow: 1,
  },

  // Bubble
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: 12,
    maxWidth: '85%',
  },
  bubbleRowUser: {
    alignSelf: 'flex-end',
  },
  bubbleRowAssistant: {
    alignSelf: 'flex-start',
    gap: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    maxWidth: '100%',
  },
  userBubble: {
    borderBottomRightRadius: 6,
  },
  assistantBubble: {
    borderBottomLeftRadius: 6,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
  },
  timestamp: {
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },

  // System message
  systemMsgContainer: {
    alignItems: 'center',
    marginVertical: 6,
  },
  systemMsgText: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Thinking
  thinkingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 8,
  },
  thinkingText: {
    fontSize: 13,
  },

  // Input
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
    borderWidth: 1,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    fontSize: 20,
    fontWeight: '700',
  },
});
