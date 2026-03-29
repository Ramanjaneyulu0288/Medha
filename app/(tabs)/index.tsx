import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { brainStore } from '@/utils/BrainStore';
import { useFocusEffect } from '@react-navigation/native';
import { Directory, File, Paths } from 'expo-file-system/next';
import { initLlama, LlamaContext } from 'llama.rn';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

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

// ── Status Badge ──
function StatusBadge({ status, label, onPress }: { status: string; label: string; onPress?: () => void }) {
  const colorScheme = useColorScheme() ?? 'dark';
  const theme = Colors[colorScheme];
  const color =
    status === 'ready'
      ? theme.success
      : status === 'loading'
        ? theme.accent
        : theme.error;

  return (
    <TouchableOpacity 
      onPress={onPress}
      disabled={!onPress}
      style={[styles.badge, { backgroundColor: color + '15', borderColor: color + '30' }]}
    >
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const ANALYTICAL_PROMPT_TEMPLATE = `You are Medha, an analytical RAG assistant. Your goal is to provide precise answers based ONLY on the provided CONTEXT, using strict logic.

---
REASONING FRAMEWORK:

1. ENTITY ISOLATION & SUBJECT PINNING: 
   - Identify the "Primary Subject" from the user's question. 
   - Treat notes about other people as background noise. Do NOT merge data between different names.

2. LOGICAL INFERENCE (ACTION -> STATE):
   - "I gave [Amount] to [Person]" -> [Person] owes you that amount.
   - "[Person] paid back [Amount]" -> Subtract from their debt.
   - "I started [Task]" -> The task is currently "In Progress."

3. TOPIC SILOING:
   - Do NOT substitute nouns for relationship terms. If the note says "Surya," stay with "Surya."

4. CHRONOLOGY:
   - Always evaluate surviving facts in the order they occurred to calculate the final net state.

---
YOUR TASK:
Use the **"Strikeout Method"** to process the CONTEXT. Do not skip steps.

<scratchpad>
1. Primary Subject: [Who/What is this specifically about?]
2. Raw Facts: [List ALL facts found in the CONTEXT.]
3. Strikeout (Filtering): [Explicitly list which facts from Step 2 do NOT mention the Primary Subject and REJECT them.]
4. Bailout Check: [If 0 facts remain after Step 3, write "ABORT" and skip to the final answer.]
5. Net State Calculation: [Chronologically apply the Action->State rules to the surviving facts to find the final result.]
</scratchpad>

ANSWER: 
- If Step 4 says "ABORT", you MUST respond exactly with: "I don't have enough clear information in your notes to answer that."
- Otherwise, provide a concise, direct answer based ONLY on Step 5. Do NOT explain your math in the final answer.

CONTEXT:
{CONTEXT}

RECENT CONVERSATION:
{CHAT_HISTORY}

USER QUESTION:
{QUESTION}`;

/**
 * Generates a model-specific prompt based on the GGUF filename.
 * Supports Llama 3, Gemma 2, Mistral, DeepSeek, and ChatML (Qwen/Phi).
 */
function formatPrompt(modelName: string, systemTemplate: string, context: string, userQuery: string, history: string): string {
  const name = modelName.toLowerCase();
  const retrievalContext = context || "No context provided.";
  
  // 1. Fill the template placeholders
  const processedSystem = systemTemplate
    .replace('{CONTEXT}', retrievalContext)
    .replace('{CHAT_HISTORY}', history || "No previous messages.")
    .replace('{QUESTION}', userQuery);

  // 2. Wrap in model-specific tags
  
  // Llama 3.x / 3.2 Instruct
  if (name.includes('llama-3')) {
    return `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${processedSystem}<|eot_id|>` +
           `<|start_header_id|>assistant<|end_header_id|>\n\n`;
  }

  // Phi-3 / Phi-3.5
  if (name.includes('phi-3')) {
    return `<|user|>\n${processedSystem}<|end|>\n<|assistant|>`;
  }

  // ChatML (Qwen, DeepSeek-R1 Distill)
  if (name.includes('qwen') || name.includes('deepseek')) {
    return `<|im_start|>system\n${processedSystem}<|im_end|>\n` +
           `<|im_start|>user\nProvide the response as requested.<|im_end|>\n` +
           `<|im_start|>assistant\n`;
  }

  // Gemma 2 IT
  if (name.includes('gemma')) {
    return `<start_of_turn>user\n${processedSystem}<end_of_turn>\n<start_of_turn>model\n`;
  }

  // Mistral / Mixtral [Inst]
  if (name.includes('mistral') || name.includes('mixtral') || name.includes('pixtral')) {
    return `[INST] ${processedSystem} [/INST]`;
  }

  // DeepSeek / Alpaca / Generic
  if (name.includes('alpaca')) {
    return `### Instruction:\n${processedSystem}\n\n### Response:\n`;
  }

  // Default fallback (Modified Alpaca style)
  return `### System:\n${processedSystem}\n\n### User:\nAnswer the query from the context above.\n\n### Assistant:\n`;
}

// ── Chat Bubble ──
function ChatBubble({ message, theme }: { message: ChatMessage; theme: typeof Colors.dark }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <View style={styles.systemMsgContainer}>
        <Text
          selectable={true}
          style={[styles.systemMsgText, { color: theme.subtitle }]}
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
            { color: isUser ? 'rgba(255,255,255,0.7)' : theme.subtitle },
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
  const theme = Colors[colorScheme];

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
  const [isModelModalVisible, setIsModelModalVisible] = useState(false);

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

  // Refresh model list when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      refreshModelList();
    }, [])
  );

  async function refreshModelList() {
    try {
      const dir = new Directory(Paths.document);
      const contents = dir.list();
      const files = contents.map(item => item.name).filter(f => f.endsWith('.gguf'));
      const chatModels = files.filter(f => !f.includes('MiniLM'));
      setAvailableModels(chatModels);
      
      // Force sync with BrainStore: if BrainStore has a different model active, switch to it
      if (brainStore.activeChatModel && brainStore.activeChatModel !== selectedModel) {
        setSelectedModel(brainStore.activeChatModel);
      } else if (!selectedModel && chatModels.length > 0) {
        // Fallback for first load
        const fallback = brainStore.activeChatModel || chatModels[0];
        setSelectedModel(fallback);
        brainStore.activeChatModel = fallback;
      }
    } catch (e) {
      console.warn('Silent model list refresh failed', e);
    }
  }

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

      // ── Hybrid Search: Add FTS5 Virtual Table ──
      // Note: Reverted FTS5 due to environment module absence.
      // We now use LIKE-based weighting directly in the vector query for maximum compatibility.

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

      // Auto-select model: check BrainStore first, then fall back to first chat model
      if (chatModels.length > 0) {
        const initial = brainStore.activeChatModel || chatModels[0];
        setSelectedModel(initial);
        brainStore.activeChatModel = initial;
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

  // Sync back to BrainStore if changed from within index.tsx
  useEffect(() => {
    if (selectedModel) {
      brainStore.activeChatModel = selectedModel;
    }
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
    addSystemMessage("🧠 Looking into memories...");

    try {
      // 1. Slash command for adding a note to the Brain
      if (text.toLowerCase().startsWith('/note ')) {
        const noteContent = text.slice(6).trim();
        const embedResult = await embedContextRef.current.embedding(noteContent);
        
        const f32Array = new Float32Array(embedResult.embedding);
        const buffer = new Uint8Array(f32Array.buffer);
        
        const insertRes = dbRef.current.execute('INSERT INTO notes (content) VALUES (?)', [noteContent]);
        let lastId = insertRes.insertId;
        if (!lastId) {
          const idRes = dbRef.current.execute('SELECT last_insert_rowid() as id');
          lastId = idRes.rows?._array?.[0]?.id || idRes.rows?.item?.(0)?.id || idRes.rows?.[0]?.id;
        }
        
        // Insert into Vector Table (Semantic)
        dbRef.current.execute(`INSERT INTO notes_vec (rowid, embedding) VALUES (${Math.floor(Number(lastId))}, ?)`, [f32Array.buffer]);
        
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'assistant', content: '✅ Note saved and vectorized!', timestamp: new Date() }
        ]);
        setIsThinking(false);
        return;
      }

      // 2. Vectorize and Extract keywords
      const embedResult = await embedContextRef.current.embedding(text);
      const f32Array = new Float32Array(embedResult.embedding);
      const words = text.split(/\s+/).filter(w => w.length > 3);
      const mainKeyword = words.length > 0 ? words[0] : text;

      // 3. Hybrid Search: Semantic (Vector) + Keyword Weighting (LIKE)
      const searchRes = dbRef.current.execute(
        `
        SELECT 
          notes.id, 
          notes.content, 
          (1.0 / (notes_vec.distance + 0.01)) + (CASE WHEN notes.content LIKE ? OR notes.content LIKE ? THEN 8.0 ELSE 0.0 END) as total_rank
        FROM notes_vec
        JOIN notes ON notes.id = notes_vec.rowid
        WHERE embedding MATCH ? AND k = 10
        ORDER BY total_rank DESC
        LIMIT 7
        `,
        // We match both capitalized and lowercase for robustness
        [`%${mainKeyword}%`, `%${mainKeyword.toLowerCase()}%`, f32Array.buffer]
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
        addSystemMessage(`🧠 Insight: Found ${topNotes.length} memories related to your query.`);
        console.log("🧠 MEDHA RAG DEBUG - Retrieved Context:", contextStr);
      } else {
        addSystemMessage("🧠 Insight: No specific memories found for this query.");
        console.log("🧠 MEDHA RAG DEBUG - No relevant notes found for query:", text);
      }

      // 4. Construct Chat History for context pinning (Last 4 messages)
      const historyStr = messages
        .filter(m => m.role !== 'system')
        .slice(-4)
        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n');

      // 5. Construct Prompt Dynamically
      const finalPrompt = formatPrompt(selectedModel || '', ANALYTICAL_PROMPT_TEMPLATE, contextStr, text, historyStr);

      const responseId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        { id: responseId, role: 'assistant', content: '', timestamp: new Date() },
      ]);

      // 5. Stream Tokens
      await chatContextRef.current.completion(
        { prompt: finalPrompt, n_predict: 512, temperature: 0.1 },
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
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.headerIcon, { backgroundColor: theme.accent }]}>
            <Text style={styles.headerIconText}>M</Text>
          </View>
          <View>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Medha</Text>
            <Text style={[styles.headerSubtitle, { color: theme.subtitle }]}>
              Your Second Brain
            </Text>
          </View>
        </View>
        <View style={styles.headerBadges}>
          {isThinking && (
            <TouchableOpacity
              style={[styles.stopButton, { borderColor: theme.error, marginRight: 8 }]}
              onPress={async () => {
                if (chatContextRef.current) {
                  await chatContextRef.current.stopCompletion();
                }
              }}
            >
              <Text style={{ color: theme.error, fontWeight: '700', fontSize: 10 }}>STOP</Text>
            </TouchableOpacity>
          )}
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
            onPress={() => setIsModelModalVisible(true)}
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
              <Text style={[styles.emptySubtitle, { color: theme.subtitle }]}>
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
            <Text style={[styles.thinkingText, { color: theme.subtitle }]}>
              Medha is thinking...
            </Text>
          </View>
        )}

        <View style={[styles.inputContainer, { borderTopColor: theme.border }]}>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: theme.assistantBubble,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask Medha anything..."
            placeholderTextColor={theme.subtitle}
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
                  inputText.trim() && !isThinking ? theme.accent : theme.border,
              },
            ]}
          >
            <Text
              style={[
                styles.sendButtonText,
                {
                  color:
                    inputText.trim() && !isThinking ? '#FFFFFF' : theme.subtitle,
                },
              ]}
            >
              ↑
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Model Selector Modal */}
      <Modal
        visible={isModelModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsModelModalVisible(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setIsModelModalVisible(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Switch Thinker Model</Text>
            <Text style={[styles.modalSubtitle, { color: theme.subtitle }]}>Select active brain for chat</Text>
            
            <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
              {availableModels.length === 0 ? (
                <Text style={{ color: theme.subtitle, textAlign: 'center', padding: 20 }}>
                  No other models found. Download more in the Models tab!
                </Text>
              ) : (
                availableModels.map((model) => (
                  <TouchableOpacity
                    key={model}
                    style={[
                      styles.modelOption,
                      { borderColor: theme.border },
                      selectedModel === model && { backgroundColor: theme.accent + '20', borderColor: theme.accent }
                    ]}
                    onPress={() => {
                      setSelectedModel(model);
                      setIsModelModalVisible(false);
                    }}
                  >
                    <Text style={[
                      styles.modelOptionText, 
                      { color: theme.text },
                      selectedModel === model && { color: theme.accent, fontWeight: '700' }
                    ]}>
                      {model.replace('.gguf', '')}
                    </Text>
                    {selectedModel === model && <Text style={{ color: theme.accent, fontWeight: '800' }}>✓</Text>}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            
            <TouchableOpacity 
              style={[styles.modalCloseBtn, { backgroundColor: theme.border }]} 
              onPress={() => setIsModelModalVisible(false)}
            >
              <Text style={[styles.modalCloseText, { color: theme.text }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
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
    paddingVertical: 14,
    paddingTop: Platform.OS === 'android' ? 45 : 12,
    borderBottomWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
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
    fontSize: 20,
    fontWeight: '800',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: -1,
  },
  headerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  // Status Badge
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Messages
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexGrow: 1,
  },

  // Bubble
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: 16,
    maxWidth: '88%',
  },
  bubbleRowUser: {
    alignSelf: 'flex-end',
  },
  bubbleRowAssistant: {
    alignSelf: 'flex-start',
    gap: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 22,
    maxWidth: '100%',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
  },
  userBubble: {
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
  },
  timestamp: {
    fontSize: 10,
    marginTop: 6,
    alignSelf: 'flex-end',
    fontWeight: '600',
  },

  // System message
  systemMsgContainer: {
    alignItems: 'center',
    marginVertical: 10,
    paddingHorizontal: 40,
  },
  systemMsgText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    opacity: 0.7,
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 140,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: '80%',
  },

  // Thinking
  stopButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thinkingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
    gap: 10,
  },
  thinkingText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Input
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    gap: 10,
  },
  input: {
    flex: 1,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 16,
    maxHeight: 140,
    borderWidth: 1,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  sendButtonText: {
    fontSize: 22,
    fontWeight: '800',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxHeight: '60%',
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    fontWeight: '500',
  },
  modalList: {
    marginVertical: 10,
  },
  modelOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  modelOptionText: {
    fontSize: 15,
    fontWeight: '600',
  },
  modalCloseBtn: {
    marginTop: 10,
    padding: 14,
    borderRadius: 16,
    alignItems: 'center',
  },
  modalCloseText: {
    fontWeight: '700',
    fontSize: 15,
  },
});
