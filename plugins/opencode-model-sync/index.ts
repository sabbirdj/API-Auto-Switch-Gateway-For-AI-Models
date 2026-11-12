// opencode-api-switch-sync
//
// Auto-detects models exposed by an API Switch Gateway (https://github.com/sabbirdj/API-Auto-Switch-Gateway-For-AI-Models)
// and registers them in OpenCode automatically. Add a model in the gateway
// dashboard -> it appears in OpenCode's /models picker without any config edit.
//
// Usage in ~/.config/opencode/opencode.json (global) or a project config:
//   "plugins": [
//     {
//       "package": "C:/path/to/API Switch/plugins/opencode-model-sync",
//       "options": {
//         "gatewayURL": "http://localhost:3000",
//         "apiKey": "sk_...",            // optional: gateway master key
//         "providerID": "api-switch",     // optional: OpenCode provider ID
//         "pollSec": 60                   // optional: refresh interval
//       }
//     }
//   ]
import { Model, Plugin, Provider } from "@opencode/plugin"

const DEFAULT_CONTEXT = 1_000_000
const DEFAULT_OUTPUT = 64_000

const prettyName = (id) =>
  id
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()

export default Plugin.define({
  id: "api-switch.model-sync",
  async setup(ctx) {
    const opts = ctx.options ?? {}
    const gatewayURL = (opts.gatewayURL ?? "http://localhost:3000").replace(/\/+$/, "")
    const apiKey = opts.apiKey ?? ""
    const providerID = Provider.ID.make(opts.providerID ?? "api-switch")
    const pollMs = Math.max(10, Number(opts.pollSec ?? 60)) * 1000

    let cachedModels = []

    const fetchModels = async () => {
      try {
        const res = await fetch(`${gatewayURL}/v1/models`, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const ids = (data?.data ?? []).map((m) => m?.id).filter(Boolean)
        return [...new Set(ids)]
      } catch (err) {
        // Gateway down or unreachable: keep last known list so sessions don't break
        console.warn(`[api-switch.model-sync] gateway unreachable (${err.message}); keeping ${cachedModels.length} known model(s)`)
        return cachedModels
      }
    }

    const toModelInfo = (id) => ({
      ...Model.Info.default(providerID, Model.ID.make(id)),
      name: `${prettyName(id)} (Auto-Rotate)`,
      limit: { context: DEFAULT_CONTEXT, output: DEFAULT_OUTPUT },
    })

    // Initial load before the synchronous transform
    cachedModels = await fetchModels()

    await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          name: "API Switch Gateway",
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          settings: {
            baseURL: `${gatewayURL}/v1`,
            ...(apiKey ? { apiKey } : {}),
          },
        },
        models: cachedModels.map(toModelInfo),
      })
    })

    console.log(`[api-switch.model-sync] registered ${cachedModels.length} model(s): ${cachedModels.join(", ")}`)

    // Poll the gateway so newly added models show up automatically
    const timer = setInterval(async () => {
      try {
        const fresh = await fetchModels()
        const changed =
          fresh.length !== cachedModels.length ||
          fresh.some((id) => !cachedModels.includes(id))
        if (!changed) return
        cachedModels = fresh
        await ctx.provider.transform((editor) => {
          editor.models.set(providerID, fresh.map(toModelInfo))
        })
        await ctx.provider.reload()
        console.log(`[api-switch.model-sync] updated model list: ${fresh.join(", ")}`)
      } catch (err) {
        console.warn(`[api-switch.model-sync] refresh failed: ${err.message}`)
      }
    }, pollMs)

    return () => clearInterval(timer)
  },
})
