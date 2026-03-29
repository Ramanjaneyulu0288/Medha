import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { brainStore } from '@/utils/BrainStore';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { Directory, File, Paths } from 'expo-file-system/next';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type ModelInfo = {
  id: string;
  name: string;
  description: string;
  url: string;
  filename: string;
  sizeEstimate: string;
  type: 'embedding' | 'chat';
};

const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: 'minilm',
    name: 'all-MiniLM-L6-v2 (Embedding)',
    description: 'Required: Small embedding model for converting notes into searchable vectors.',
    url: 'https://huggingface.co/bartowski/all-MiniLM-L6-v2-GGUF/resolve/main/all-MiniLM-L6-v2-Q8_0.gguf?download=true',
    filename: 'all-MiniLM-L6-v2.gguf',
    sizeEstimate: '45 MB',
    type: 'embedding',
  },
  // {
  //   id: 'deepseek-r1-1.5b',
  //   name: 'DeepSeek-R1 1.5B Distill',
  //   description: 'High-tier reasoning distilled from R1. Best balance of logic and speed for mobile.',
  //   url: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf?download=true',
  //   filename: 'deepseek-r1-1.5b-q4_k_m.gguf',
  //   sizeEstimate: '1.1 GB',
  //   type: 'chat',
  // },
  // {
  //   id: 'llama-3.2-1b',
  //   name: 'Llama 3.2 1B (Q4_K_M)',
  //   description: 'Meta’s ultra-lightweight generalist. Extremely fast response times.',
  //   url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf?download=true',
  //   filename: 'llama-3.2-1b-q4_k_m.gguf',
  //   sizeEstimate: '800 MB',
  //   type: 'chat',
  // },
  {
    id: 'phi-3.5-mini',
    name: 'Phi-3.5 Mini Instruct',
    description: 'Microsoft’s compact reasoning model. Excellent at following complex multi-step instructions.',
    url: 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf?download=true',
    filename: 'phi-3.5-mini-q4_k_m.gguf',
    sizeEstimate: '2.4 GB',
    type: 'chat',
  },
  {
    id: 'mistral-7b',
    name: 'Mistral 7B v0.3 Instruct (Q4_K_M)',
    description: 'Highly acclaimed generalist. Balanced, reliable, and excellent for complex reasoning.',
    url: 'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf?download=true',
    filename: 'mistral-7b-v0.3-q4_k_m.gguf',
    sizeEstimate: '4.4 GB',
    type: 'chat',
  },
  {
    id: 'llama-3.2-3b',
    name: 'Llama 3.2 3B (Q4_K_M)',
    description: 'Stronger alternative to the 1B model. Better logical consistency for complex queries.',
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf?download=true',
    filename: 'llama-3.2-3b-q4_k_m.gguf',
    sizeEstimate: '2.0 GB',
    type: 'chat',
  },
  {
    id: 'deepseek-r1-7b',
    name: 'DeepSeek-R1 7B Distill (Q4_K_M)',
    description: 'Top-tier reasoning model. Requires high-end hardware (8GB+ RAM).',
    url: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf?download=true',
    filename: 'deepseek-r1-7b-q4_k_m.gguf',
    sizeEstimate: '4.7 GB',
    type: 'chat',
  }
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
      setActiveModel(brainStore.activeChatModel);
    }, [])
  );

  async function checkDownloadedModels() {
    try {
      // Modern API
      const dir = new Directory(Paths.document);
      const contents = dir.list();
      const models = contents.map(item => item.name).filter(file => file.endsWith('.gguf'));
      setDownloadedFiles(models);
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
      const file = new File(Paths.document, model.filename);
      file.delete();
      checkDownloadedModels();
    } catch (e) {
      console.error(`Error deleting ${model.name}:`, e);
    }
  }
  function renderModel({ item }: { item: ModelInfo }) {
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
                        brainStore.activeChatModel = item.filename;
                        setActiveModel(item.filename);
                      }}
                    >
                      <Text style={styles.buttonText}>Activate</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[styles.button, styles.deleteButton, { borderColor: theme.error + '60' }]} onPress={() => deleteModel(item)}>
                    <Text style={[styles.deleteButtonText, { color: theme.error }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <TouchableOpacity style={[styles.button, { backgroundColor: theme.accent }]} onPress={() => downloadModel(item)}>
                <Text style={styles.buttonText}>Download Model</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
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
