/**
 * Shared contracts for the LLM layer.
 *
 * Every model the console can talk to is described here, and every provider is
 * an adapter behind one narrow interface. UI code never knows which vendor is
 * behind a model; server code never guesses a request shape.
 */

export type ProviderId =
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'mistral'
  | 'deepseek'
  | 'together'
  | 'huggingface'
  | 'cohere'
  | 'ollama'
  | 'litellm'
  | 'vllm'
  | 'custom'
  | 'bedrock';

export type ProviderKind =
  | 'openai-compatible'
  | 'anthropic'
  | 'google'
  | 'cohere'
  | 'unsupported';

/** What a model can actually be used for. Verified means tested in this repo. */
export type ModelRole = 'chat' | 'vision' | 'code' | 'speech-in' | 'speech-out' | 'omni';

/** Where inference physically happens. */
export type Execution = 'cloud' | 'self-hosted' | 'on-device';

export type LLMErrorCode =
  | 'no-credential'
  | 'unsupported-provider'
  | 'unknown-model'
  | 'auth-failed'
  | 'rate-limited'
  | 'not-found'
  | 'provider-error'
  | 'network-error'
  | 'timeout'
  | 'bad-response'
  | 'config-error'
  | 'cancelled';

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly fix: string;
  readonly provider?: ProviderId;
  readonly model?: string;
  readonly status?: number;

  constructor(options: {
    code: LLMErrorCode;
    message: string;
    fix: string;
    provider?: ProviderId;
    model?: string;
    status?: number;
  }) {
    super(options.message);
    this.name = 'LLMError';
    this.code = options.code;
    this.fix = options.fix;
    this.provider = options.provider;
    this.model = options.model;
    this.status = options.status;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      fix: this.fix,
      provider: this.provider,
      model: this.model,
      status: this.status,
    };
  }
}

export interface ModelSpec {
  /** Stable identifier used by the UI and the API, e.g. `openrouter/qwen-2.5-72b`. */
  id: string;
  label: string;
  provider: ProviderId;
  /** The model string the provider expects on the wire. */
  upstreamModel: string;
  roles: ModelRole[];
  contextWindow?: number;
  licence?: string;
  execution: Execution;
  /** Free-text caveat shown in the UI — never claims more than we know. */
  notes?: string;
  /** true only once a live probe has succeeded against this deployment. */
  verified?: boolean;
}

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  defaultBaseUrl: string;
  /** Environment variables checked, in order, for a server-side credential. */
  envKeys: string[];
  requiresKey: boolean;
  supportsModelList: boolean;
  docsUrl: string;
  /** Why a provider cannot be used yet, when kind === 'unsupported'. */
  unsupportedReason?: string;
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: ChatTurn[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  text: string;
  model: string;
  provider: ProviderId;
  execution: Execution;
  latencyMs: number;
  usage?: ChatUsage;
}

export interface DiscoveredModel {
  /** `<provider>/<upstream-model>` — already a valid `/api/chat` model id. */
  id: string;
  label: string;
  provider: ProviderId;
  upstreamModel: string;
  contextWindow?: number;
  /** Added by /api/models: does this deployment hold the credential? */
  configured?: boolean;
  /** Added by /api/models: has it answered a live request in this instance? */
  verified?: boolean;
}

export interface ProviderStatus {
  provider: ProviderId;
  label: string;
  kind: ProviderKind;
  configured: boolean;
  source: 'env' | 'user' | 'none';
  baseUrl: string;
  requiresKey: boolean;
  supportsModelList: boolean;
  docsUrl: string;
  envKeys: string[];
  note?: string;
}

export interface ModelStatus {
  id: string;
  label: string;
  provider: ProviderId;
  upstreamModel: string;
  roles: ModelRole[];
  execution: Execution;
  configured: boolean;
  reachable: boolean | null;
  latencyMs?: number;
  error?: { code: LLMErrorCode; message: string; fix: string };
  evidence?: string;
}
