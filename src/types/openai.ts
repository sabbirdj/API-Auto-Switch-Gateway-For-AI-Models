export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  max_tokens?: number;
  max_completion_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
  tools?: any[];
  tool_choice?: any;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: any[];
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  system_fingerprint?: string;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: {
    role?: 'assistant';
    content?: string;
    tool_calls?: any[];
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ModelObject {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  permission?: any[];
  root?: string;
  parent?: string | null;
  metadata?: {
    isVirtual?: boolean;
    strategy?: string;
    targets?: string[];
    provider?: string;
  };
}

export interface ModelListResponse {
  object: 'list';
  data: ModelObject[];
}
