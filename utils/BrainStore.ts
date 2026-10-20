import { LlamaContext } from 'llama.rn';

class BrainStore {
  db: any = null;
  embedContext: LlamaContext | null = null;
  chatContext: LlamaContext | null = null;
  activeChatModel: string | null = null;
  isGenerating: boolean = false;
}

export const brainStore = new BrainStore();
