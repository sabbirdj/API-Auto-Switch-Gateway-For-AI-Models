import { ProviderAdapter } from './base.js';
import { OpenAICompatibleAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';
import { ProviderType } from '../types/provider.js';

export * from './base.js';
export * from './openai.js';
export * from './anthropic.js';
export * from './gemini.js';

class AdapterRegistry {
  private adapters: Map<string, ProviderAdapter> = new Map();

  constructor() {
    this.adapters.set('openai', new OpenAICompatibleAdapter('OpenAI', 'https://api.openai.com/v1'));
    this.adapters.set('groq', new OpenAICompatibleAdapter('Groq', 'https://api.groq.com/openai/v1'));
    this.adapters.set('deepseek', new OpenAICompatibleAdapter('DeepSeek', 'https://api.deepseek.com/v1'));
    this.adapters.set('ollama', new OpenAICompatibleAdapter('Ollama', 'http://localhost:11434/v1'));
    this.adapters.set('custom', new OpenAICompatibleAdapter('Custom', 'https://api.openai.com/v1'));
    this.adapters.set('anthropic', new AnthropicAdapter());
    this.adapters.set('gemini', new GeminiAdapter());
  }

  public getAdapter(type: ProviderType): ProviderAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      // Default to OpenAI-compatible for any unknown or custom endpoints
      return this.adapters.get('openai')!;
    }
    return adapter;
  }
}

export const adapterRegistry = new AdapterRegistry();
