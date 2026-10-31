/** AutoSchema — DeepSeek Chat 客户端（JSON 模式 + 重试 + 超时）。 */

import type { ChatClient, DeepseekConfig, Logger } from './types.js'
import { silentLogger, truncate } from './util.js'

export class DeepseekError extends Error {
  readonly status?: number
  readonly body?: string
  constructor(message: string, options: { status?: number; body?: string } = {}) {
    super(message)
    this.name = 'DeepseekError'
    this.status = options.status
    this.body = options.body
  }
}

const RETRYABLE = (status: number): boolean => status === 429 || status >= 500

export class DeepseekClient implements ChatClient {
  constructor(
    private readonly config: DeepseekConfig,
    private readonly apiKey: string,
    private readonly logger: Logger = silentLogger(),
  ) {}

  private endpoint(): string {
    return `${this.config.baseUrl.replace(/\/+$/u, '')}/chat/completions`
  }

  async chat(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string> {
    const attempts = Math.max(0, this.config.retries) + 1
    let lastError: Error | undefined
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
      try {
        const response = await fetch(this.endpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: this.config.model,
            messages,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            stream: false,
            ...(this.config.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const text = truncate(await response.text().catch(() => ''), 600)
          const error = new DeepseekError(`DeepSeek HTTP ${response.status}`, { status: response.status, body: text })
          if (!RETRYABLE(response.status) || attempt >= attempts) throw error
          lastError = error
        } else {
          const payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> }
          const content = payload.choices?.[0]?.message?.content
          if (typeof content === 'string' && content.trim() !== '') return content
          const error = new DeepseekError('DeepSeek 返回空内容')
          if (attempt >= attempts) throw error
          lastError = error
        }
      } catch (error) {
        if (error instanceof DeepseekError) {
          if (!error.status || !RETRYABLE(error.status) || attempt >= attempts) throw error
          lastError = error
        } else {
          const wrapped = new DeepseekError(`DeepSeek 请求失败：${error instanceof Error ? error.message : String(error)}`)
          if (attempt >= attempts) throw wrapped
          lastError = wrapped
        }
      } finally {
        clearTimeout(timer)
      }
      const delay = 250 * 2 ** (attempt - 1)
      this.logger.warn(`DeepSeek 失败，${delay}ms 后重试（第 ${attempt}/${attempts} 次）`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    throw lastError ?? new DeepseekError('DeepSeek 调用失败')
  }
}
