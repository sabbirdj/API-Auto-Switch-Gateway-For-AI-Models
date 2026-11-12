# 🔀 AI Auto-Switch Gateway For AI Models

> **Universal, low-latency AI proxy gateway that pools multiple API keys per provider, automatically switches keys on `429 Rate Limit` errors, and exposes unified OpenAI & Anthropic compatible endpoints.**

[![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-5.x-black.svg?logo=express)](https://expressjs.com/)
[![License](https://img.shields.io/badge/license-ISC-orange.svg)](LICENSE)
[![Cache](https://img.shields.io/badge/0ms-Memory%20Cache-emerald.svg)]()
[![Streaming](https://img.shields.io/badge/SSE-Realtime%20Stream-violet.svg)]()

---

## 📖 Overview

When developing with AI coding assistants (like **OpenCode**, **Cursor**, **Cline**, or custom applications), free or low-tier API keys frequently run into **`429 Too Many Requests` (Rate Limits)**. 

**AI Auto-Switch Gateway** solves this problem by acting as an intelligent middleman:
1. You paste **multiple API keys** for any provider (Groq, Google Gemini, OpenAI, Anthropic Claude, DeepSeek, OpenRouter, etc.).
2. You point your tools (OpenCode, Cursor, Python scripts) to **one single local endpoint** (`http://localhost:3000/v1`).
3. Whenever a key hits a rate limit or quota exhaustion, the gateway **automatically switches to the next available key in milliseconds** without your client application ever noticing or crashing!

---

## 🚀 Key Features

* 🔄 **Zero-Downtime Multi-Key Auto-Rotation**: Paste 2, 5, 10, or 50 keys for any provider. The router round-robins across keys and transparently fails over to the next key on HTTP 429, timeouts, or 5xx errors.
* ⏳ **Smart Cooldown Recovery**: Rate-limited keys automatically enter an isolated cooldown state (default 60s) and rejoin the rotation pool once their rate limit window expires.
* 🔌 **Dual Universal Ingress (OpenAI + Anthropic)**:
  * **OpenAI Format:** `POST http://localhost:3000/v1/chat/completions` & `GET /v1/models`
  * **Anthropic Format:** `POST http://localhost:3000/v1/messages`
* ⚡ **Instant 0ms In-Memory Response Cache**: Identical prompts are served directly from RAM in **< 1ms**, preserving API quotas and providing zero-latency responses.
* 🌊 **Low-Latency Server-Sent Events (SSE) Streaming**: Words stream to your editor/client in real time with Time-To-First-Token (TTFT) as fast as **~100–200 ms**.
* 🌐 **Any Provider & Custom Base URL Support**: Built-in support for **Google Gemini**, **Groq**, **OpenAI**, **Anthropic Claude**, **DeepSeek**, and **Ollama**, plus custom endpoints like **OpenRouter**, **Together AI**, **Mistral**, **vLLM**, **LM Studio**, and **Azure OpenAI**.
* 🖥️ **Modern Web Admin Dashboard**: Beautiful dark-mode UI at `http://localhost:3000` with live key status badges, real-time streaming playground, request audit logs, and provider management.

---

## 🏗️ Architecture & How It Works

```
 Client (OpenCode, Cursor, Cline, SDKs)
                  │
                  ▼
   AI Auto-Switch Gateway (localhost:3000)
                  │
      ┌───────────┴──────────────────────────────┐
      │ ⚡ Check 0ms In-Memory Cache             │
      │ 🔑 Select Active Provider & Available Key│
      └───────────┬──────────────────────────────┘
                  │
        ┌─────────┴───────────────────────┐
        ▼                                 ▼
   [ Key 1 ]                         [ Key 2 ]
   ❌ 429 Rate Limit!                ✅ Success!
   (Placed in cooldown for 60s)      (Returns stream to client)
                  │
                  ▼
        Upstream AI Providers
 (Groq / Gemini / OpenAI / Anthropic / DeepSeek / Custom)
```

---

## ⚡ Quick Start

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v18.0.0 or higher, v20+ recommended)
* `npm` or `yarn`

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/sabbirdj/API-Auto-Switch-Gateway-For-AI-Models.git
cd API-Auto-Switch-Gateway-For-AI-Models

# Install dependencies
npm install
```

### 3. Build & Run

#### Development Mode (with live hot-reload):
```bash
npm run dev
```

#### Production Mode:
```bash
npm run build
npm start
```

### 4. Access the Dashboard
Open your browser and navigate to:
👉 **[http://localhost:3000](http://localhost:3000)**

* Go to **API Keys & Providers** $\rightarrow$ Click **"+ Add Keys"** on your preferred provider (e.g. Groq or Gemini).
* Paste all your API keys (one per line).
* Select your **Active Provider** from the dropdown at the top.

---

## 💻 Client Configuration Guides

### 1. OpenCode (`opencode.json`)
In your project's root folder (or globally at `~/.config/opencode/opencode.json`), configure API Switch as a custom OpenAI-compatible provider:

> **⚠️ Important (OpenCode V2):** Use the `"package"` field — **not** `"npm"`. The legacy `"npm": "@ai-sdk/openai"` field is rejected by OpenCode V2 and causes `SessionRunnerModel.UnsupportedPackageError` at runtime.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "api-switch/glm-5-3-flash",
  "providers": {
    "api-switch": {
      "name": "API Switch Gateway",
      "env": ["API_SWITCH_KEY"],
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://localhost:3000/v1",
        "apiKey": "sk_564dd7437hn3v7cx738m83v"
      },
      "models": {
        "llama-3.3-70b-versatile": {
          "name": "Llama 3.3 70B (Auto-Rotate)",
          "limit": { "context": 128000, "output": 32000 }
        },
        "gemini-2.0-flash": {
          "name": "Gemini 2.0 Flash (Auto-Rotate)",
          "limit": { "context": 1000000, "output": 64000 }
        }
      }
    }
  }
}
```

> **Tip:** Model keys in the `models` map must match the model IDs your gateway exposes (check `GET /v1/models`). Add any model your active provider serves — e.g. `glm-5-3-flash`, `deepseek-v4-1-flash-1017`, `gpt-4o-mini`. Use `limit` to declare each model's real context/output window. To make a model the default, set the top-level `"model"` key to `api-switch/<model-id>`.

Or pass via environment variables in terminal:
```bash
export OPENAI_BASE_URL="http://localhost:3000/v1"
export OPENAI_API_KEY="sk_564dd7437hn3v7cx738m83v"
opencode
```

---

### 2. Cursor / Open WebUI / LibreChat
In settings:
* **OpenAI Base URL:** `http://localhost:3000/v1`
* **API Key:** `sk_564dd7437hn3v7cx738m83v` *(or whatever Master Key you set in Settings)*
* **Model:** Choose any model configured on your active provider (e.g., `llama-3.3-70b-versatile`, `gemini-2.0-flash`, `gpt-4o-mini`).

---

### 3. VS Code Extensions (Cline / Roo Code / Continue)

#### Cline / Roo Code:
* **Provider:** `OpenAI Compatible`
* **Base URL:** `http://localhost:3000/v1`
* **API Key:** `sk_564dd7437hn3v7cx738m83v`
* **Model ID:** `llama-3.3-70b-versatile`

#### Continue.dev (`config.json`):
```json
{
  "models": [
    {
      "title": "API Switch Auto-Rotate",
      "provider": "openai",
      "model": "llama-3.3-70b-versatile",
      "apiKey": "sk_564dd7437hn3v7cx738m83v",
      "apiBase": "http://localhost:3000/v1"
    }
  ]
}
```

---

### 4. Python (`openai` SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk_564dd7437hn3v7cx738m83v"
)

response = client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=[{"role": "user", "content": "Explain async programming in 2 sentences."}],
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

---

### 5. Python (`anthropic` SDK)

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:3000",  # SDK appends /v1/messages itself — don't add /v1
    api_key="sk_564dd7437hn3v7cx738m83v"
)

message = client.messages.create(
    # Use any model ID the gateway exposes (GET /v1/models).
    # Requests are translated and routed to your active provider.
    model="claude-3-5-sonnet-20241022",  # or e.g. "glm-5-3-flash", "llama-3.3-70b-versatile"
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello via Anthropic protocol!"}]
)

print(message.content[0].text)
```

---

### 6. cURL

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk_564dd7437hn3v7cx738m83v" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "Ping"}]
  }'
```

---

## 📡 Gateway API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/v1/chat/completions` | Standard OpenAI chat completions (supports JSON and SSE streaming) |
| `GET` | `/v1/models` | List all available models across configured providers |
| `POST` | `/v1/messages` | Native Anthropic Claude Messages endpoint |
| `GET` | `/health` | Server health check and uptime status |
| `GET` | `/api/dashboard` | Returns providers, key pool status, stats, and recent logs |
| `POST` | `/api/providers/:id/keys` | Add multiple API keys to a provider |
| `DELETE` | `/api/providers/:id/keys/:keyId` | Remove a single key from a provider |
| `POST` | `/api/providers/:id/keys/reset-cooldown` | Instantly reset rate-limit cooldown on all keys |
| `POST` | `/api/providers` | Create or update a custom provider |
| `POST` | `/api/test` | Live test endpoint with real-time SSE streaming for dashboard playground |
| `POST` | `/api/cache/clear` | Clear the 0ms in-memory response cache |

---

## ⚙️ Configuration & Environment Variables

You can customize the gateway via `.env` or in the **Settings** tab on the web dashboard:

```env
# Port to listen on (default: 3000)
PORT=3000

# Master API Key required by clients to authenticate with the gateway
MASTER_API_KEY=sk_564dd7437hn3v7cx738m83v
```

---

## 📁 Project Structure

```text
API-Auto-Switch-Gateway-For-AI-Models/
├── public/
│   └── index.html             # Single-Page Web Admin Dashboard (Tailwind CSS, Icons)
├── src/
│   ├── index.ts               # Express server entry point & route definitions
│   ├── adapters/              # Provider translation layers
│   │   ├── base.ts            # Base ProviderAdapter interface & ProviderError
│   │   ├── openai.ts          # Direct OpenAI, Groq, DeepSeek, Ollama adapter
│   │   ├── anthropic.ts       # Anthropic Messages API translator
│   │   ├── gemini.ts          # Google Gemini GenerateContent translator
│   │   └── index.ts           # Adapter registry
│   ├── db/
│   │   └── storage.ts         # Persistent JSON storage & key pool state manager
│   ├── engine/
│   │   ├── router.ts          # Key rotation router with 429 auto-switch logic
│   │   └── cache.ts           # Instant 0ms In-Memory response cache
│   ├── routes/
│   │   ├── v1/
│   │   │   ├── chat.ts        # POST /v1/chat/completions & GET /v1/models
│   │   │   └── anthropicMessages.ts # POST /v1/messages
│   │   └── api/
│   │       └── admin.ts       # Control plane REST API for dashboard
│   └── types/
│       └── openai.ts          # Standard OpenAI schemas
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🤝 Contributing

Contributions are welcome! If you'd like to add support for more providers, optimize adapters, or enhance the dashboard:
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **ISC** License. See `LICENSE` for more information.
