import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { brainStore } from '@/utils/BrainStore';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { Directory, File, Paths } from 'expo-file-system/next';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, InteractionManager, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export type ModelInfo = {
  id: string;
  name: string;
  description: string;
  url: string;
  filename: string;
  sizeEstimate: string;
  type: 'embedding' | 'chat';
};

export const AVAILABLE_MODELS: ModelInfo[] = [
  // ── 1. EMBEDDING MODELS (Nomic Embed Text v1.5 - 768 Dimensions) ──
  {
    id: 'nomic-embed-text-v1.5-q8',
    name: 'Nomic Embed Text v1.5 (Recommended) ⭐',
    description: 'High-precision 768-dim embeddings. 8192 context window and native asymmetric retrieval.',
    url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf',
    filename: 'nomic-embed-text-v1.5.Q8_0.gguf',
    sizeEstimate: '139 MB',
    type: 'embedding',
  },
  {
    id: 'nomic-embed-text-v1.5-q4',
    name: 'Nomic Embed Text v1.5 (Q4_K_M)',
    description: 'Ultra-compact 768-dim embeddings. 8192 context window, optimized for minimal mobile RAM.',
    url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf',
    filename: 'nomic-embed-text-v1.5.Q4_K_M.gguf',
    sizeEstimate: '80 MB',
    type: 'embedding',
  },

  // ── 2. SWEET-SPOT CHAT MODELS (1.5B – 3.8B, Best for Mobile) ──
  {
    id: 'qwen-2.5-3b',
    name: 'Qwen 2.5 3B Instruct (Recommended)',
    description: 'Best overall mobile model. Superb reasoning, tool calling, and instruction following.',
    url: 'https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    sizeEstimate: '1.8 GB',
    type: 'chat',
  },
  {
    id: 'deepseek-r1-1.5b',
    name: 'DeepSeek-R1 Distill 1.5B',
    description: 'Distilled reasoning with step-by-step thinking (<think>). Low RAM footprint.',
    url: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf',
    filename: 'deepseek-r1-1.5b-q4_k_m.gguf',
    sizeEstimate: '1.1 GB',
    type: 'chat',
  },
  {
    id: 'phi-4-mini',
    name: 'Phi-4 Mini 3.8B Instruct',
    description: 'Microsoft’s flagship compact model. State-of-the-art math, logic, and reasoning.',
    url: 'https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf',
    filename: 'microsoft_phi-4-mini-instruct-q4_k_m.gguf',
    sizeEstimate: '2.4 GB',
    type: 'chat',
  },
  {
    id: 'llama-3.2-1b',
    name: 'Llama 3.2 1B Instruct',
    description: 'Meta’s ultra-lightweight generalist. Lightning fast responses and minimal battery usage.',
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    filename: 'llama-3.2-1b-q4_k_m.gguf',
    sizeEstimate: '770 MB',
    type: 'chat',
  },
  {
    id: 'qwen-2.5-1.5b',
    name: 'Qwen 2.5 1.5B Instruct',
    description: 'Ultra-compact Qwen model. Snappy performance, high multilingual capability.',
    url: 'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    sizeEstimate: '940 MB',
    type: 'chat',
  },
  {
    id: 'llama-3.2-3b',
    name: 'Llama 3.2 3B Instruct',
    description: 'Meta’s 3B generalist. Strong conversational coherence and factual consistency.',
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    filename: 'llama-3.2-3b-q4_k_m.gguf',
    sizeEstimate: '1.9 GB',
    type: 'chat',
  },

  // ── 3. FLAGSHIP / HIGH-RAM MODELS (8GB+ RAM Devices Only) ──
  {
    id: 'qwen-2.5-7b',
    name: 'Qwen 2.5 7B Instruct',
    description: 'High-intelligence reasoning model for flagship devices with 8GB+ RAM.',
    url: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    filename: 'qwen2.5-7b-instruct-q4_k_m.gguf',
    sizeEstimate: '4.5 GB',
    type: 'chat',
  },
  {
    id: 'gemma-4-e4b-it',
    name: 'Gemma 4 E4B Instruct (Q4_K_M)',
    description: 'Unsloth quantized Gemma 4 E4B Instruct model in Q4_K_M for experimental multimodal use.',
    url: 'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf',
    filename: 'gemma-4-e4b-it-q4_k_m.gguf',
    sizeEstimate: '4.7 GB',
    type: 'chat',
  },
];

export default function ModelsScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];

  const [downloadedFiles, setDownloadedFiles] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<Record<string, number>>({});
  const [activeModel, setActiveModel] = useState<string | null>(brainStore.activeChatModel);

  useEffect(() => {
    checkDownloadedModels();
  }, []);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        setActiveModel(brainStore.activeChatModel);
        checkDownloadedModels();
      });
      return () => task.cancel();
    }, [])
  );

  async function checkDownloadedModels() {
    try {
      const dir = new Directory(Paths.document);
      const contents = dir.list();
      const models = contents
        .filter((item) => {
          if (!item.name.endsWith('.gguf')) return false;
          try {
            const f = new File(Paths.document, item.name);
            return f.exists && (f.size ?? 0) > 20 * 1024 * 1024;
          } catch {
            return false;
          }
        })
        .map((item) => item.name);
      
      setDownloadedFiles(prev => {
        if (prev.length === models.length && prev.every((m, i) => m === models[i])) {
          return prev;
        }
        return models;
      });
    } catch (e) {
      console.error('Error reading models directory:', e);
    }
  }

  async function downloadModel(model: ModelInfo) {
    // using legacy API for downloadResumable since it provides progress callbacks
    const fileUri = new File(Paths.document, model.filename).uri;
    
    const downloadResumable = FileSystemLegacy.createDownloadResumable(
      model.url,
      fileUri,
      {},
      (downloadProgress) => {
        const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
        setDownloading(prev => ({
          ...prev,
          [model.id]: progress * 100
        }));
      }
    );

    try {
      setDownloading(prev => ({ ...prev, [model.id]: 0 }));
      await downloadResumable.downloadAsync();
      setDownloading(prev => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
      checkDownloadedModels();
    } catch (e) {
      console.error(`Error downloading ${model.name}:`, e);
      setDownloading(prev => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
    }
  }

  async function deleteModel(model: ModelInfo) {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const file = new File(Paths.document, model.filename);
      file.delete();
      if (brainStore.activeChatModel === model.filename) {
        brainStore.activeChatModel = null;
        setActiveModel(null);
      }
      checkDownloadedModels();
    } catch (e) {
      console.error(`Error deleting ${model.name}:`, e);
    }
  }
  const renderModel = useCallback(
    ({ item }: { item: ModelInfo }) => {
      const isDownloaded = downloadedFiles.includes(item.filename);
      const downloadProgress = downloading[item.id];
      const isDownloading = downloadProgress !== undefined;
      const isActive = activeModel === item.filename;

      return (
        <View style={[styles.modelCard, { backgroundColor: theme.assistantBubble, borderColor: isActive ? theme.accent : theme.border, borderWidth: isActive ? 2 : 1 }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.modelName, { color: theme.text }]}>{item.name}</Text>
            <View style={[styles.modelBadge, { backgroundColor: item.type === 'embedding' ? theme.accent + '20' : theme.tint + '20' }]}>
              <Text style={[styles.modelBadgeText, { color: item.type === 'embedding' ? theme.accent : theme.tint }]}>
                {item.type === 'embedding' ? 'ENCODER' : 'THINKER'}
              </Text>
            </View>
          </View>
          
          <Text style={[styles.modelDescription, { color: theme.subtitle }]}>{item.description}</Text>
          <Text style={[styles.modelSize, { color: theme.subtitle }]}>Size: {item.sizeEstimate}</Text>

          {isDownloading ? (
            <View style={styles.progressContainer}>
              <Text style={{ color: theme.text, fontWeight: '600', fontSize: 13 }}>Downloading: {downloadProgress.toFixed(1)}%</Text>
              <View style={[styles.progressBarBg, { backgroundColor: theme.border }]}>
                <View style={[styles.progressBarFill, { width: `${downloadProgress}%`, backgroundColor: theme.accent }]} />
              </View>
            </View>
          ) : (
            <View style={styles.actionRow}>
              {isDownloaded ? (
                <>
                  <View style={styles.downloadedStatus}>
                    <Text style={[styles.downloadedText, { color: isActive ? theme.accent : theme.success }]}>●</Text>
                    <Text style={[styles.downloadedText, { color: theme.text, marginLeft: 6 }]}>
                      {isActive ? 'Active Now' : 'Installed'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {!isActive && item.type === 'chat' && (
                      <TouchableOpacity 
                        style={[styles.button, { backgroundColor: theme.accent }]} 
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          brainStore.activeChatModel = item.filename;
                          setActiveModel(item.filename);
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.buttonText, { color: theme.userBubbleText }]}>Activate</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={[styles.button, styles.deleteButton, { borderColor: theme.error + '60' }]} onPress={() => deleteModel(item)}>
                      <Text style={[styles.deleteButtonText, { color: theme.error }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <TouchableOpacity style={[styles.button, { backgroundColor: theme.accent }]} onPress={() => downloadModel(item)}>
                  <Text style={[styles.buttonText, { color: theme.userBubbleText }]}>Download Model</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      );
    },
    [downloadedFiles, downloading, activeModel, theme]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Model Center</Text>
        <Text style={[styles.subtitle, { color: theme.subtitle }]}>
          Download AI brains to run locally on your device.
        </Text>
      </View>

      <FlatList
        data={AVAILABLE_MODELS}
        keyExtractor={item => item.id}
        renderItem={renderModel}
        contentContainerStyle={styles.list}
        extraData={[downloadedFiles, downloading, activeModel]}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 24,
    paddingBottom: 16,
    paddingTop: Platform.OS === 'android' ? 45 : 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  list: {
    padding: 16,
  },
  modelCard: {
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  modelName: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  modelBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  modelBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  modelDescription: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 10,
  },
  modelSize: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 16,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  downloadedStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  button: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 22,
    elevation: 2,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
  deleteButton: {
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  deleteButtonText: {
    fontWeight: '800',
    fontSize: 14,
  },
  downloadedText: {
    fontSize: 15,
    fontWeight: '700',
  },
  progressContainer: {
    marginTop: 4,
  },
  progressBarBg: {
    height: 10,
    borderRadius: 5,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  }
});
