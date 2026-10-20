import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { brainStore } from '@/utils/BrainStore';
import { getInsertId, readRows } from '@/utils/db';
import { embedText, runEmbeddingSelfTest } from '@/utils/embeddings';
import { getSemanticIntent, extractFinancialTargetPerson } from '@/utils/Router';
import { extractKeywords } from '@/utils/text';
import {
  initLedgerTable,
  recordLedgerFromNote,
  getPersonBalance,
  getAllBalances,
  PersonBalanceSummary,
  OverallBalanceSummary,
} from '@/utils/ledgerEngine';
import { LedgerCard } from '@/components/ui/LedgerCard';
import { useFocusEffect } from '@react-navigation/native';
import { Directory, File, Paths } from 'expo-file-system/next';
import * as Haptics from 'expo-haptics';
import { initLlama, LlamaContext } from 'llama.rn';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
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
  ledgerPersonSummary?: PersonBalanceSummary | null;
  ledgerOverallSummary?: OverallBalanceSummary | null;
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

/**
 * Checks if a user's input is a casual greeting or conversational pleasantry.
 * When true, we bypass notes database retrieval to answer instantly and naturally.
 */
function isCasualGreeting(query: string): boolean {
  const clean = query
    .trim()
    .toLowerCase()
    .replace(/[!?.,;:\-_]/g, '')
    .trim();
  const greetings = new Set([
    'hi',
    'hello',
    'hey',
    'hey there',
    'hi there',
    'hello there',
    'hey medha',
    'hi medha',
    'hello medha',
    'good morning',
    'good afternoon',
    'good evening',
    'good day',
    'good night',
    'howdy',
    'hola',
    'namaste',
    'how are you',
    'how are you doing',
    'how are u',
    'how r u',
    'hows it going',
    "how's it going",
    'how is it going',
    'whats up',
    "what's up",
    'sup',
    'yo',
    'who are you',
    'what is your name',
    'what are you',
    'what can you do',
    'help',
    'thanks',
    'thank you',
    'ok',
    'okay',
    'cool',
    'awesome',
    'nice',
  ]);
  return greetings.has(clean);
}

/**
 * Builds the system instructions for Medha.
 * - When relevant notes exist, injects them cleanly and directs the model to use them.
 * - When NO notes exist, does NOT inject an empty "NOTES: No notes" block, allowing
 *   casual greetings and general questions to be answered naturally and warmly.
 */
function buildSystemPrompt(contextStr?: string): string {
  if (contextStr && contextStr.trim().length > 0) {
    return `You are Medha, a smart, friendly, and private on-device AI assistant and personal Second Brain.

RELEVANT SAVED NOTES & MEMORIES:
${contextStr}

GUIDELINES:
- When the user asks about their personal notes, debts, tasks, or saved records, use the saved memories above as your primary source of truth.
- For debt or money calculations, calculate balances accurately based on the notes.
- If the user asks a specific question about a personal memory or note that is NOT mentioned in the notes above, let them know it's not in their notes yet and offer to save it.
- For greetings, general knowledge, coding, or casual chat, answer naturally, warmly, and helpfully.`;
  }

  return `You are Medha, a smart, friendly, and private on-device AI assistant and personal Second Brain.

GUIDELINES:
- Answer questions directly, accurately, and concisely.
- For greetings and casual conversation, respond warmly, naturally, and helpfully.
- You have general knowledge across science, tech, math, and everyday topics.
- If the user specifically asks you to retrieve or check one of their personal saved notes or memories, let them know you don't see any matching notes yet, and offer to save one for them.`;
}

/**
 * Generates a model-specific prompt based on the GGUF filename for fallback engines.
 * Supports Llama 3, Gemma 2, Mistral, DeepSeek, and ChatML (Qwen/Phi).
 */
function formatPrompt(
  modelName: string,
  systemPrompt: string,
  userQuery: string,
  recentMessages: ChatMessage[]
): string {
  const name = modelName.toLowerCase();
  const priorTurns = recentMessages
    .filter((m) => m.role !== 'system' && m.content.trim().length > 0)
    .slice(-4);

  // ChatML (Qwen 2.5, DeepSeek-R1 Distill)
  if (name.includes('qwen') || name.includes('deepseek')) {
    let prompt = `<|im_start|>system\n${systemPrompt}<|im_end|>\n`;
    for (const turn of priorTurns) {
      prompt += `<|im_start|>${turn.role === 'assistant' ? 'assistant' : 'user'}\n${turn.content}<|im_end|>\n`;
    }
    prompt += `<|im_start|>user\n${userQuery}<|im_end|>\n<|im_start|>assistant\n`;
    return prompt;
  }

  // Llama 3.x / 3.2 Instruct
  if (name.includes('llama-3') || name.includes('llama3')) {
    let prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${systemPrompt}<|eot_id|>`;
    for (const turn of priorTurns) {
      prompt += `<|start_header_id|>${turn.role === 'assistant' ? 'assistant' : 'user'}<|end_header_id|>\n\n${turn.content}<|eot_id|>`;
    }
    prompt += `<|start_header_id|>user<|end_header_id|>\n\n${userQuery}<|eot_id|>` +
              `<|start_header_id|>assistant<|end_header_id|>\n\n`;
    return prompt;
  }

  // Phi-3 / Phi-4 Mini
  if (name.includes('phi-3') || name.includes('phi-4') || name.includes('phi3') || name.includes('phi4')) {
    let prompt = `<|system|>\n${systemPrompt}<|end|>\n`;
    for (const turn of priorTurns) {
      prompt += `<|${turn.role === 'assistant' ? 'assistant' : 'user'}|>\n${turn.content}<|end|>\n`;
    }
    prompt += `<|user|>\n${userQuery}<|end|>\n<|assistant|>\n`;
    return prompt;
  }

  // Gemma 2 IT
  if (name.includes('gemma')) {
    let prompt = `<start_of_turn>user\n${systemPrompt}\n\n`;
    for (const turn of priorTurns) {
      prompt += `${turn.role.toUpperCase()}: ${turn.content}\n\n`;
    }
    prompt += `${userQuery}<end_of_turn>\n<start_of_turn>model\n`;
    return prompt;
  }

  // Mistral / Mixtral [Inst]
  if (name.includes('mistral') || name.includes('mixtral') || name.includes('pixtral')) {
    let prompt = `<s>[INST] ${systemPrompt}\n\n`;
    for (const turn of priorTurns) {
      prompt += `${turn.role.toUpperCase()}: ${turn.content}\n\n`;
    }
    prompt += `${userQuery} [/INST]`;
    return prompt;
  }

  // Default fallback (Alpaca style)
  let prompt = `### System:\n${systemPrompt}\n\n`;
  for (const turn of priorTurns) {
    prompt += `### ${turn.role === 'assistant' ? 'Assistant' : 'User'}:\n${turn.content}\n\n`;
  }
  prompt += `### User:\n${userQuery}\n\n### Assistant:\n`;
  return prompt;
}

// ── Chat Bubble (Memoized to prevent re-rendering unchanged messages during streaming) ──
const ChatBubble = React.memo(function ChatBubble({ message, theme }: { message: ChatMessage; theme: typeof Colors.dark }) {
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
        <View style={[styles.avatar, { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 }]}>
          <Text style={[styles.avatarText, { color: theme.accent }]}>✦</Text>
        </View>
      )}
      <View
        style={[
          styles.bubble,
          isUser
            ? [styles.userBubble, { backgroundColor: theme.userBubble }]
            : [styles.assistantBubble, { backgroundColor: theme.assistantBubble, borderColor: theme.border, borderWidth: 1 }],
        ]}
      >
        {message.ledgerPersonSummary ? (
          <LedgerCard personSummary={message.ledgerPersonSummary} />
        ) : null}
        {message.ledgerOverallSummary ? (
          <LedgerCard overallSummary={message.ledgerOverallSummary} />
        ) : null}
        {message.content ? (
          <Text
            selectable={true}
            style={[
              styles.bubbleText,
              { color: isUser ? theme.userBubbleText : theme.text },
            ]}
          >
            {message.content}
          </Text>
        ) : null}
        <Text
          style={[
            styles.timestamp,
            { color: isUser ? theme.userBubbleText + 'B0' : theme.subtitle },
          ]}
        >
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </View>
  );
});

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

  // Auto-scroll messages when keyboard appears so bottom message is never obscured
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 50);
      }
    );
    return () => {
      showSub.remove();
    };
  }, []);

  // Refresh model list after tab transitions complete (never block tab animation)
  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        refreshModelList();
      });
      return () => task.cancel();
    }, [])
  );

function isEmbeddingFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.includes('nomic') || lower.includes('embed') || lower.includes('minilm') || lower.includes('bge');
}

/**
 * Scans the documents directory for GGUF model files that are complete and valid (>20MB).
 * Ignores empty or interrupted download stubs.
 */
function getValidGgufFiles(): string[] {
  try {
    const dir = new Directory(Paths.document);
    const contents = dir.list();
    return contents
      .filter((item) => {
        if (!item.name.endsWith('.gguf')) return false;
        try {
          const file = new File(Paths.document, item.name);
          return file.exists && (file.size ?? 0) > 20 * 1024 * 1024;
        } catch {
          return false;
        }
      })
      .map((item) => item.name);
  } catch {
    return [];
  }
}

/**
 * Selects the optimal chat model from available files.
 * Prefers the active selection, then recommended compact models (like Qwen 2.5 3B),
 * or the smallest valid model for quick loading.
 */
function pickBestChatModel(models: string[]): string | null {
  if (models.length === 0) return null;
  if (brainStore.activeChatModel && models.includes(brainStore.activeChatModel)) {
    return brainStore.activeChatModel;
  }
  const preferred = [
    'qwen2.5-3b-instruct-q4_k_m.gguf',
    'gemma-2-2b-it-Q4_K_M.gguf',
    'deepseek-r1-distill-qwen-1.5b-q4_k_m.gguf',
    'llama-3.2-1b-instruct-q4_k_m.gguf',
    'llama-3.2-3b-instruct-q4_k_m.gguf',
  ];
  for (const pref of preferred) {
    if (models.includes(pref)) return pref;
  }
  const sorted = [...models].sort((a, b) => {
    try {
      const sizeA = new File(Paths.document, a).size ?? 0;
      const sizeB = new File(Paths.document, b).size ?? 0;
      return sizeA - sizeB;
    } catch {
      return 0;
    }
  });
  return sorted[0];
}

  async function refreshModelList() {
    try {
      const files = getValidGgufFiles();
      const chatModels = files.filter(f => !isEmbeddingFile(f));
      
      // Only trigger re-render if model array actually changed
      setAvailableModels(prev => {
        if (prev.length === chatModels.length && prev.every((m, i) => m === chatModels[i])) {
          return prev;
        }
        return chatModels;
      });
      
      const best = pickBestChatModel(chatModels);
      if (best && best !== selectedModel) {
        setSelectedModel(best);
        brainStore.activeChatModel = best;
      }
    } catch (e) {
      console.warn('Silent model list refresh failed', e);
    }
  }

  async function initializeSystems() {
    addSystemMessage('🧠 Booting Medha...');

    // 1. sqlite-vec
    await testSqliteVec();

    // 2. llama.rn models
    await loadLlamaContexts();
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

      // Ensure notes_vec is configured for 768 dimensions (Nomic Embed Text v1.5)
      try {
        const tableInfo = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='notes_vec'");
        const sql = tableInfo.rows?.[0]?.sql || '';
        if (sql && !sql.includes('768')) {
          console.log('[sqlite-vec] Upgrading notes_vec from 384 to 768 dimensions for Nomic Embed...');
          db.execute('DROP TABLE IF EXISTS notes_vec');
        }
      } catch (e) {
        console.warn('Migration check error:', e);
      }

      // Create the 768-dim vector table
      db.execute(
        'CREATE VIRTUAL TABLE IF NOT EXISTS notes_vec USING vec0(embedding float[768])'
      );

      // Create notes metadata table
      db.execute(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          media_type TEXT DEFAULT 'text',
          media_uri TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      try {
        db.execute("ALTER TABLE notes ADD COLUMN media_type TEXT DEFAULT 'text'");
      } catch {}
      try {
        db.execute("ALTER TABLE notes ADD COLUMN media_uri TEXT");
      } catch {}

      // ── Deterministic Ledger Table ──
      initLedgerTable(db);

      setStatus((prev) => ({
        ...prev,
        sqliteVec: 'ready',
        sqliteVecVersion: version,
      }));
      dbRef.current = db;
      brainStore.db = db;
      addSystemMessage(`✅ sqlite-vec ${version} loaded. Vector database ready.`);

      // Semantic Router will be initialized after embedding model loads (see loadLlamaContexts)
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

      // Find valid downloaded models (>20MB)
      const files = getValidGgufFiles();
      const embedModelFile = files.find(isEmbeddingFile);
      const chatModels = files.filter((f) => !isEmbeddingFile(f));

      setAvailableModels(chatModels);

      // Load Embedding Context
      if (embedModelFile) {
        addSystemMessage('📦 Loading Vector Engine into memory...');
        embedContextRef.current = await initLlama({
          model: new File(Paths.document, embedModelFile).uri,
          embedding: true,
          // Mean pooling collapses per-token vectors into ONE sentence vector
          pooling_type: 'mean',
          embd_normalize: 2, // L2-normalize → unit vectors (clean cosine similarity)
          n_batch: 512,
          n_ubatch: 512,
          n_ctx: 2048, // Nomic Embed supports up to 8192 tokens; 2048 is fast & generous for mobile
          use_mlock: true,
        });
        brainStore.embedContext = embedContextRef.current;
        setStatus((p) => ({ ...p, embeddingModel: 'ready', embeddingModelInfo: embedModelFile }));
        addSystemMessage('✅ Vector Engine initialized.');
      } else {
        setStatus((p) => ({ ...p, embeddingModel: 'not_found', embeddingModelInfo: 'Missing Embedding Model' }));
        addSystemMessage('⚠️ Missing embedding model. Please download it in the Models tab.');
      }

      // Auto-select best chat model
      const initial = pickBestChatModel(chatModels);
      if (initial) {
        setSelectedModel(initial);
        brainStore.activeChatModel = initial;
      } else {
        setStatus((p) => ({ ...p, chatModel: 'not_found', chatModelInfo: 'No chat model downloaded' }));
        addSystemMessage('⚠️ No chat model found. Please download one in the Models tab.');
      }
    } catch (e: any) {
      console.error('LLAMA.RN MODEL ERROR:', e);
      addSystemMessage(`⚠️ llama.rn Error: ${e.message}`);
      setStatus((p) => ({ ...p, embeddingModel: 'error', chatModel: 'error' }));
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
          brainStore.chatContext = null;
        }
        if (!isMounted) return;

        setStatus((p) => ({ ...p, chatModel: 'loading' }));
        addSystemMessage(`🧠 Loading ${selectedModel}...`);

        const context = await initLlama({
          model: new File(Paths.document, selectedModel!).uri,
          n_gpu_layers: 99,
          use_mlock: true,
          n_ctx: 2048,
          n_threads: 4, // Optimal mobile thread count for snappy response without CPU thermal choking
          n_batch: 512,
        });

        if (!isMounted) {
          context.release();
          return;
        }

        chatContextRef.current = context;
        brainStore.chatContext = context;
        setStatus((p) => ({ ...p, chatModel: 'ready', chatModelInfo: selectedModel! }));
        addSystemMessage(`✨ Medha is ready with ${selectedModel}! Ask me anything.`);
      } catch (e: any) {
        if (!isMounted) return;
        const errorMessage = e?.message || String(e);
        setStatus((p) => ({ ...p, chatModel: 'error', chatModelInfo: errorMessage }));
        addSystemMessage(`⚠️ Failed to load chat model: ${errorMessage}`);
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

    if (status.chatModel === 'error') {
      addSystemMessage(`❌ Chat model failed to load (${status.chatModelInfo}). Please select another model in the Models tab.`);
      return;
    }
    if (status.chatModel === 'loading' || !chatContextRef.current) {
      addSystemMessage(`⏳ Loading ${selectedModel || 'model'} into memory... Please wait a few seconds.`);
      return;
    }
    if (status.chatModel === 'not_found' || !selectedModel) {
      addSystemMessage("⚠️ No chat model found. Please download one in the Models tab.");
      return;
    }
    if (status.embeddingModel !== 'ready' || !embedContextRef.current || status.sqliteVec !== 'ready') {
      addSystemMessage("⏳ Initializing database and memory engine... Please wait a moment.");
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsThinking(true);
    brainStore.isGenerating = true;
    try {
      const isGreeting = isCasualGreeting(text);
      let contextStr = '';
      let personSummary: PersonBalanceSummary | null = null;
      let overallSummary: OverallBalanceSummary | null = null;

      if (!isGreeting) {
        // 1. Semantic Router: Keyword-based intent classification (zero-latency, no embeddings)
        const intent = getSemanticIntent(text);
        console.log(`[handleSend] Intent classified: ${intent}`);
        if (intent !== 'GENERAL_CHAT') {
          addSystemMessage(`🔍 Router: [${intent}]`);
        }

        // ── NOTES_ADD: Direct DB insert, bypass LLM entirely ──
        if (intent === 'NOTES_ADD') {
          const noteContent = text.replace(/^\/note\s+/i, '')
            .replace(/^(save this memory|remember that|note for later|write this down|add a note|store this|store that)\s*/gi, '')
            .trim() || text;
          
          console.log(`[handleSend] NOTES_ADD: Saving note: "${noteContent}"`);
          
          const f32Array = await embedText(embedContextRef.current, noteContent, 'document');

          const insertRes = dbRef.current.execute('INSERT INTO notes (content, media_type) VALUES (?, ?)', [noteContent, 'text']);
          const lastId = getInsertId(insertRes, dbRef.current);
          console.log(`[handleSend] NOTES_ADD: Inserted note id=${lastId}`);
          if (lastId == null) throw new Error('Could not resolve inserted note id');

          dbRef.current.execute(`INSERT INTO notes_vec (rowid, embedding) VALUES (${Math.floor(Number(lastId))}, ?)`, [f32Array.buffer]);
          console.log(`[handleSend] NOTES_ADD: Vectorized note id=${lastId}`);

          // Extract and record financial transaction (if present)
          const recordedTx = await recordLedgerFromNote(dbRef.current, Number(lastId), noteContent, chatContextRef.current);
          let successMsg = '✅ Memory saved and vectorized!\n(Bypassed LLM to save battery ⚡)';
          if (recordedTx) {
            successMsg += `\n📊 Ledger: Recorded ${recordedTx.direction === 'GAVE' ? 'Lent' : 'Received'} ₹${recordedTx.amount} (${recordedTx.original_name})`;
          }
          
          setMessages((prev) => [
            ...prev,
            { id: Date.now().toString(), role: 'assistant', content: successMsg, timestamp: new Date() }
          ]);
          brainStore.isGenerating = false;
          setIsThinking(false);
          return;
        }

        // ── WEB_SEARCH: Extract query via LLM, open browser ──
        if (intent === 'WEB_SEARCH') {
          console.log(`[handleSend] WEB_SEARCH: Extracting query from "${text}"`);
          addSystemMessage("🌐 Preparing web search...");
          
          const actionPrompt = `System:\nYou are a Web Search Route API. Extract the exact search query from the user. Output ONLY raw JSON matching this schema: {"query": "search query"}.\nDo not wrap in markdown.\nUser: ${text}\nJSON Output:\n{"query": "`;
          
          let generatedText = '{"query": "';
          
          const responseId = (Date.now() + 1).toString();
          setMessages((prev) => [
            ...prev,
            { id: responseId, role: 'assistant', content: '⏳ Parsing search query...', timestamp: new Date() },
          ]);

          await chatContextRef.current.completion(
            { prompt: actionPrompt, n_predict: 64, temperature: 0.1, stop: ["}"] },
            (res) => { generatedText += res.token; }
          );
          
          console.log(`[handleSend] WEB_SEARCH: Raw LLM output: "${generatedText}"`);
          
          const match = generatedText.match(/"query"\s*:\s*"([^"]*)/);
          const parsedQuery = match && match[1] ? match[1].trim() : text;
          
          console.log(`[handleSend] WEB_SEARCH: Parsed query: "${parsedQuery}"`);
          
          setMessages((prev) => 
            prev.map((msg) => 
              msg.id === responseId 
                ? { ...msg, content: `🌐 Opening browser for: "${parsedQuery}"` } 
                : msg
            )
          );
          
          Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(parsedQuery)}`);
          brainStore.isGenerating = false;
          setIsThinking(false);
          return;
        }

        // ── FINANCIAL_QUERY: Deterministic Ledger Math (0ms, 100% accurate) ──
        if (intent === 'FINANCIAL_QUERY') {
          console.log(`[handleSend] FINANCIAL_QUERY: Querying ledger for "${text}"`);
          const targetPerson = extractFinancialTargetPerson(text);

          if (targetPerson) {
            personSummary = getPersonBalance(dbRef.current, targetPerson);
            if (personSummary) {
              const owesText =
                personSummary.netBalance > 0
                  ? `${personSummary.person} owes you ₹${personSummary.netBalance}.`
                  : personSummary.netBalance < 0
                    ? `You owe ${personSummary.person} ₹${Math.abs(personSummary.netBalance)}.`
                    : `All dues are settled with ${personSummary.person} (balance is ₹0).`;

              let directMsg = `📊 **Balance with ${personSummary.person}**:\n`;
              directMsg += `• **Lent / Paid**: ₹${personSummary.totalGave}\n`;
              directMsg += `• **Received**: ₹${personSummary.totalReceived}\n`;
              directMsg += `• **Status**: ${owesText}`;

              setMessages((prev) => [
                ...prev,
                {
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: directMsg,
                  timestamp: new Date(),
                  ledgerPersonSummary: personSummary,
                },
              ]);
              brainStore.isGenerating = false;
              setIsThinking(false);
              return;
            } else {
              setMessages((prev) => [
                ...prev,
                {
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: `I searched your notes, but couldn't find any financial transactions or debt records with "${targetPerson}".`,
                  timestamp: new Date(),
                },
              ]);
              brainStore.isGenerating = false;
              setIsThinking(false);
              return;
            }
          } else {
            overallSummary = getAllBalances(dbRef.current);
            let directMsg = `📊 **Overall Financial Summary**:\n\n`;

            if (overallSummary.totalUserOwes > 0) {
              directMsg += `• **Total Debt (You owe others)**: ₹${overallSummary.totalUserOwes}\n`;
              for (const d of overallSummary.debtors) {
                directMsg += `   - You owe ${d.person}: ₹${d.amountUserOwes}\n`;
              }
            } else {
              directMsg += `• **Total Debt (You owe others)**: ₹0 (No debts!)\n`;
            }

            directMsg += `\n`;

            if (overallSummary.totalOwedToUser > 0) {
              directMsg += `• **Total Receivables (Others owe you)**: ₹${overallSummary.totalOwedToUser}\n`;
              for (const c of overallSummary.creditors) {
                directMsg += `   - ${c.person} owes you: ₹${c.amountOwedToUser}\n`;
              }
            } else {
              directMsg += `• **Total Receivables (Others owe you)**: ₹0\n`;
            }

            directMsg += `\n`;
            if (overallSummary.netBalance > 0) {
              directMsg += `• **Net Position**: **+₹${overallSummary.netBalance}** (You are net positive / owed more than you owe).`;
            } else if (overallSummary.netBalance < 0) {
              directMsg += `• **Net Position**: **-₹${Math.abs(overallSummary.netBalance)}** (You owe more than you are owed).`;
            } else {
              directMsg += `• **Net Position**: **₹0** (All dues are completely balanced).`;
            }

            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString(),
                role: 'assistant',
                content: directMsg,
                timestamp: new Date(),
                ledgerOverallSummary: overallSummary,
              },
            ]);
            brainStore.isGenerating = false;
            setIsThinking(false);
            return;
          }
        } else {
          // ── RAG PIPELINE: Runs for other queries and memories ──
          console.log(`[handleSend] RAG Pipeline starting for intent: ${intent}`);
          console.log(`[handleSend] Embedding query: "${text}"`);
          const f32Array = await embedText(embedContextRef.current, text, 'query');
          console.log(`[handleSend] Embedding done. Vector length: ${f32Array.length}, first val: ${f32Array[0]}`);
          
          const keywords = extractKeywords(text);
          console.log(`[handleSend] Keywords for boost: [${keywords.join(', ')}]`);

          const boostClause =
            keywords.length > 0
              ? `(CASE WHEN ${keywords.map(() => 'notes.content LIKE ?').join(' OR ')} THEN 5.0 ELSE 0.0 END)`
              : '0.0';
          const searchRes = dbRef.current.execute(
            `
            SELECT
              notes.id,
              notes.content,
              (1.0 / (notes_vec.distance + 0.01)) + ${boostClause} as total_rank
            FROM notes_vec
            JOIN notes ON notes.id = notes_vec.rowid
            WHERE embedding MATCH ? AND k = 8
            ORDER BY total_rank DESC
            LIMIT 5
            `,
            [...keywords.map((k) => `%${k}%`), f32Array.buffer]
          );

          const topNotes: any[] = readRows(searchRes);

          console.log(`[handleSend] Search returned ${topNotes.length} notes`);
          topNotes.forEach((n: any, i: number) => {
            console.log(`[handleSend]   Note ${i + 1}: [rank=${n.total_rank?.toFixed(2)}] "${n.content?.substring(0, 80)}"`);
          });

          const topRank = topNotes[0]?.total_rank ?? 0;
          const relevantNotes = topNotes.filter((n: any) => (n.total_rank ?? 0) >= topRank * 0.5);

          if (relevantNotes.length > 0) {
            contextStr = relevantNotes.map((n: any) => `- ${n.content}`).join('\n');
            console.log(`[handleSend] Injecting ${relevantNotes.length}/${topNotes.length} notes as context.`);
            addSystemMessage(
              `🧠 Found ${relevantNotes.length} relevant ${relevantNotes.length === 1 ? 'memory' : 'memories'}.`
            );
          } else if (intent === 'NOTES_SEARCH') {
            console.log(`[handleSend] No notes found for search query.`);
            addSystemMessage('🧠 No specific memories found for this query.');
          }
        }
      } else {
        console.log(`[handleSend] Casual greeting detected ("${text}"). Skipping notes retrieval.`);
      }

      // 5. Build the chat and run completion.
      const chatCtx = chatContextRef.current;
      if (!chatCtx) throw new Error('Chat model not loaded');

      const responseId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        {
          id: responseId,
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          ledgerPersonSummary: personSummary,
          ledgerOverallSummary: overallSummary,
        },
      ]);

      // High-performance token buffer: Flushes to state every ~50ms instead of 30+ times/sec
      let accumulatedContent = '';
      let lastFlushTime = 0;
      let flushTimeout: any = null;

      const flushToState = (isFinal = false) => {
        if (flushTimeout) {
          clearTimeout(flushTimeout);
          flushTimeout = null;
        }
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === responseId
              ? {
                  ...msg,
                  content: accumulatedContent,
                  ledgerPersonSummary: personSummary,
                  ledgerOverallSummary: overallSummary,
                }
              : msg
          )
        );
        if (isFinal) {
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
        } else {
          flatListRef.current?.scrollToEnd({ animated: false });
        }
      };

      const onToken = (res: { token: string }) => {
        accumulatedContent += res.token;
        const now = Date.now();
        if (now - lastFlushTime > 50) {
          lastFlushTime = now;
          flushToState(false);
        } else if (!flushTimeout) {
          flushTimeout = setTimeout(() => {
            lastFlushTime = Date.now();
            flushToState(false);
          }, 50);
        }
      };

      let useJinja = false;
      try { useJinja = chatCtx.isJinjaSupported(); } catch { useJinja = false; }
      console.log(`[handleSend] Context injected: ${contextStr.length > 0 ? 'YES' : 'NO'} (${contextStr.length} chars)`);
      console.log(`[handleSend] Chat formatting: ${useJinja ? 'jinja (model template)' : 'formatPrompt fallback'}`);
      console.log(`[handleSend] Starting LLM completion...`);

      const systemContent = buildSystemPrompt(contextStr);

      // 6. Stream Tokens
      if (useJinja) {
        const priorTurns = messages
          .filter((m) => m.role !== 'system' && m.content.trim().length > 0)
          .slice(-6)
          .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
        await chatCtx.completion(
          {
            messages: [
              { role: 'system', content: systemContent },
              ...priorTurns,
              { role: 'user', content: text },
            ],
            jinja: true,
            n_predict: 512,
            temperature: 0.6,
          },
          onToken
        );
      } else {
        const finalPrompt = formatPrompt(selectedModel || '', systemContent, text, messages);
        console.log(`[handleSend] Fallback prompt length: ${finalPrompt.length} chars`);
        await chatCtx.completion(
          { prompt: finalPrompt, n_predict: 512, temperature: 0.6 },
          onToken
        );
      }
      flushToState(true);
      console.log(`[handleSend] LLM completion finished.`);

    } catch (e: any) {
      console.error('[handleSend] ERROR:', e);
      addSystemMessage(`❌ Generation error: ${e.message}`);
    } finally {
      brainStore.isGenerating = false;
      setIsThinking(false);
    }
  }

  // ── Render ──
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.headerIcon, { backgroundColor: theme.accent }]}>
            <Text style={[styles.headerIconText, { color: theme.userBubbleText }]}>M</Text>
          </View>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.headerTitle, { color: theme.text }]}>Medha</Text>
              <Text style={{ fontSize: 13, color: theme.accent }}>✦</Text>
            </View>
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
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }}
          onLayout={() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIconBg, { backgroundColor: theme.accent + '20', borderColor: theme.accent + '40', borderWidth: 1 }]}>
                <Text style={[styles.emptyIcon, { color: theme.accent }]}>✦</Text>
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                Medha Brain
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.subtitle }]}>
                Your private, on-device AI assistant connected to your memories.
              </Text>

              <View style={styles.quickPrompts}>
                <TouchableOpacity
                  style={[styles.promptChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setInputText("What memories do I have saved?");
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.promptChipText, { color: theme.text }]}>📝 What memories do I have saved?</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.promptChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setInputText("Summarize what I need to remember");
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.promptChipText, { color: theme.text }]}>💡 Summarize what I need to remember</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.promptChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setInputText("/note Medha is my private second brain");
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.promptChipText, { color: theme.text }]}>⚡ /note Save a new memory</Text>
                </TouchableOpacity>
              </View>
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

        <View style={[styles.inputContainer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
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
            placeholder={
              status.chatModel === 'loading'
                ? `Loading ${selectedModel?.replace(/\.gguf$/i, '') || 'model'}...`
                : status.chatModel === 'error'
                  ? 'Model failed to load. Pick another in Models tab.'
                  : 'Ask Medha anything...'
            }
            placeholderTextColor={theme.subtitle}
            multiline
            maxLength={2000}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
            onFocus={() => {
              setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
              }, 80);
            }}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!inputText.trim() || isThinking || status.chatModel === 'loading'}
            style={[
              styles.sendButton,
              {
                backgroundColor:
                  inputText.trim() && !isThinking && status.chatModel !== 'loading'
                    ? theme.accent
                    : theme.surface,
                borderColor: theme.border,
                borderWidth: 1,
              },
            ]}
          >
            <Text
              style={[
                styles.sendButtonText,
                {
                  color:
                    inputText.trim() && !isThinking ? theme.userBubbleText : theme.subtitle,
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
    paddingTop: 40,
    paddingBottom: 40,
  },
  emptyIconBg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyIcon: {
    fontSize: 36,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: '80%',
  },
  quickPrompts: {
    marginTop: 24,
    width: '90%',
    gap: 10,
  },
  promptChip: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  promptChipText: {
    fontSize: 14,
    fontWeight: '600',
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
