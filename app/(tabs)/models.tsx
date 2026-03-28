import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { Directory, Paths, File } from 'expo-file-system/next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

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
    name: 'all-MiniLM-L6-v2',
    description: 'Required: Small embedding model for converting notes into searchable vectors.',
    url: 'https://huggingface.co/second-state/All-MiniLM-L6-v2-Embedding-GGUF/resolve/main/all-MiniLM-L6-v2-ggml-model-f16.gguf',
    filename: 'all-MiniLM-L6-v2.gguf',
    sizeEstimate: '45 MB',
    type: 'embedding',
  },
  {
    id: 'gemma-2b',
    name: 'Gemma 2B (Q4_K_M)',
    description: 'Fast, highly capable chat model from Google. Excellent for on-device reasoning.',
    url: 'https://huggingface.co/lmstudio-community/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
    filename: 'gemma-2-2b-it-Q4_K_M.gguf',
    sizeEstimate: '1.6 GB',
    type: 'chat',
  },
  {
    id: 'llama-3.2-1b',
    name: 'Llama 3.2 1B (Q4_K_M)',
    description: 'Lightweight chat model from Meta. Faster but slightly less accurate than Gemma 2B.',
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-1B-Instruct-Q4.gguf',
    sizeEstimate: '800 MB',
    type: 'chat',
  }
];

export default function ModelsScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];

  const [downloadedFiles, setDownloadedFiles] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<Record<string, number>>({});

  useEffect(() => {
    checkDownloadedModels();
  }, []);

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

    return (
      <View style={[styles.modelCard, { backgroundColor: colorScheme === 'dark' ? '#1c1c1e' : '#f5f5f5', borderColor: colorScheme === 'dark' ? '#333' : '#e5e5ea' }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.modelName, { color: theme.text }]}>{item.name}</Text>
          <Text style={[styles.modelBadge, { 
            backgroundColor: item.type === 'embedding' ? '#e6f4fe' : '#fce8e6',
            color: item.type === 'embedding' ? '#0070c9' : '#d93025'
          }]}>
            {item.type === 'embedding' ? 'Vector Engine' : 'Thinker (LLM)'}
          </Text>
        </View>
        
        <Text style={[styles.modelDescription, { color: colorScheme === 'dark' ? '#a1a1aa' : '#666' }]}>{item.description}</Text>
        <Text style={[styles.modelSize, { color: colorScheme === 'dark' ? '#a1a1aa' : '#666' }]}>Size: {item.sizeEstimate}</Text>

        {isDownloading ? (
          <View style={styles.progressContainer}>
            <Text style={{ color: theme.text }}>Downloading: {downloadProgress.toFixed(1)}%</Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${downloadProgress}%`, backgroundColor: theme.tint }]} />
            </View>
          </View>
        ) : (
          <View style={styles.actionRow}>
            {isDownloaded ? (
              <>
                <Text style={styles.downloadedText}>✅ Downloaded</Text>
                <TouchableOpacity style={[styles.button, styles.deleteButton]} onPress={() => deleteModel(item)}>
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={[styles.button, { backgroundColor: theme.tint }]} onPress={() => downloadModel(item)}>
                <Text style={styles.buttonText}>Download</Text>
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
        <Text style={[styles.title, { color: theme.text }]}>Model Manager</Text>
        <Text style={[styles.subtitle, { color: colorScheme === 'dark' ? '#a1a1aa' : '#666' }]}>
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
    padding: 20,
    paddingBottom: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
  },
  list: {
    padding: 16,
  },
  modelCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modelName: {
    fontSize: 18,
    fontWeight: '600',
  },
  modelBadge: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  modelDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  modelSize: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ff3b30',
  },
  deleteButtonText: {
    color: '#ff3b30',
    fontWeight: '600',
  },
  downloadedText: {
    color: '#34c759',
    fontWeight: '600',
  },
  progressContainer: {
    marginTop: 10,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#e5e5ea',
    borderRadius: 4,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
  }
});
