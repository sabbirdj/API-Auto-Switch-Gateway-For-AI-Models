# 🔀 AI API Switch & Master Gateway

An intelligent AI proxy and routing gateway that exposes a single, unified **Master OpenAI-compatible API** (`/v1/chat/completions`) while dynamically switching, load-balancing, and failing over across multiple 3rd-party AI providers (Google Gemini, Groq, OpenAI, Anthropic Claude, DeepSeek, and local Ollama).

---

## ✨ Key Features

1. **One Master API for Everything**: Standard OpenAI `/v1/chat/completions` and `/v1/models` endpoints. Connect Cursor, LibreChat, Open WebUI, Python `openai` SDK, or LangChain without changing code.
2. **Provider Normalization & Adapters**: Bidirectional translation layer for:
   * **Google Gemini** (contents / systemInstruction / SSE streams)
   * **Anthropic Claude** (messages / system / SSE deltas)
   * **OpenAI, Groq, DeepSeek, Mistral, Ollama** (direct proxy & streaming)
3. **Automated Failover Chains**: If your primary model hits a `429 Rate Limit`, times out, or returns `5xx`, the gateway switches seamlessly to the next configured fallback provider in milliseconds.
4. **Virtual Model Aliasing**: Define virtual routes like `master`, `smart`, or `fast`:
   * `master` $\rightarrow$ Gemini Flash $\rightarrow$ Groq Llama 3.3 $\rightarrow$ GPT-4o-mini $\rightarrow$ Claude 3.5 Sonnet
   * `fast` $\rightarrow$ 50/50 Load balance between Groq and Gemini Flash
5. **Key Pooling & Quota Rotation**: Store multiple API keys per provider to rotate requests and bypass single-key limits.
6. **Full Streaming SSE Support**: Real-time token streaming normalized into OpenAI delta events.
7. **Built-in Web Admin Dashboard**:
   * Visual route manager and fallback chain editor
   * Provider key manager with live connection latency tester
   * Interactive live testing playground
   * Real-time request audit logs and token metrics

---

## 🚀 Quick Start

### 1. Install & Build
```bash
# Clone or navigate to the workspace
cd "API Switch"

# Run in development mode (with hot-reload)
npm run dev

# Or build and run for production
npm run build
npm start
```

### 2. Access the Dashboard
Open **[http://localhost:3000](http://localhost:3000)** in your browser:
* Add your API keys under **Providers & API Keys** (OpenAI, Gemini, Groq, Anthropic, DeepSeek, Ollama).
* Customize your switching fallback chains under **Switching Routes & Aliases**.
* Test routes immediately in the **Live Playground**.

---

## 📡 Using the Master API

### Master Endpoint Details
* **Base URL**: `http://localhost:3000/v1`
* **Chat Completions**: `POST http://localhost:3000/v1/chat/completions`
* **Models List**: `GET http://localhost:3000/v1/models`
* **Master API Key**: `sk-switch-master-key` (configurable in settings or dashboard)

---

### Python Example (`openai` SDK)

```python
from openai import OpenAI

# Point OpenAI client to your local Master API Switch
client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-switch-master-key"
)

# Request the virtual "master" route (auto-failover enabled)
response = client.chat.completions.create(
    model="master",
    messages=[{"role": "user", "content": "Explain quantum entanglement in 2 sentences."}],
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

---

### Node.js / TypeScript Example

```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'sk-switch-master-key',
});

const completion = await openai.chat.completions.create({
  model: 'master', // Or 'fast', 'smart'
  messages: [{ role: 'user', content: 'What is the speed of light?' }],
});

console.log(completion.choices[0].message.content);
```

---

### cURL Example

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-switch-master-key" \
  -d '{
    "model": "master",
    "messages": [
      {"role": "user", "content": "Hello, world!"}
    ],
    "stream": false
  }'
```

---

## ⚙️ Architecture & Directory Structure

```text
API Switch/
├── src/
│   ├── index.ts               # Express server entry point
│   ├── types/
│   │   ├── openai.ts          # Master OpenAI chat completions & chunk types
│   │   └── provider.ts        # Provider configs, route schemas, audit log types
│   ├── adapters/
│   │   ├── base.ts            # Base ProviderAdapter interface & ProviderError
│   │   ├── openai.ts          # Direct OpenAI, Groq, DeepSeek, Ollama adapter
│   │   ├── anthropic.ts       # Anthropic Messages API bidirectional translator
│   │   ├── gemini.ts          # Google Gemini GenerateContent translator
│   │   └── index.ts           # Adapter registry
│   ├── engine/
│   │   ├── router.ts          # Routing & Failover execution engine
│   │   └── keyPool.ts         # Multi-key rotation & cooldown manager
│   ├── db/
│   │   └── storage.ts         # JSON persistence manager (data/config.json, data/logs.json)
│   └── routes/
│       ├── v1/
│       │   ├── chat.ts        # Master /v1/chat/completions endpoint
│       │   └── models.ts      # Master /v1/models endpoint
│       └── api/
│           └── admin.ts       # Admin management API (CRUD providers, routes, logs)
├── public/
│   └── index.html             # Sleek dark-mode Web Admin Dashboard
├── data/                      # Auto-created storage directory
│   ├── config.json            # Persistent providers & route definitions
│   └── logs.json              # Request audit trail & token tracking
├── tsconfig.json
└── package.json
```

---

## 🛡️ License
ISC
