import { REFERENCE_PROMPT } from '@renderer/config/prompts'
import { getLMStudioKeepAliveTime } from '@renderer/hooks/useLMStudio'
import { getOllamaKeepAliveTime } from '@renderer/hooks/useOllama'
import { getKnowledgeReferences } from '@renderer/services/KnowledgeService'
import store from '@renderer/store'
import { Assistant, GenerateImageParams, Message, Model, Provider, Suggestion } from '@renderer/types'
import { delay, isJSON, parseJSON } from '@renderer/utils'
import Logger from 'electron-log'
import OpenAI from 'openai'

import { CompletionsParams } from '.'

export default abstract class BaseProvider {
  protected provider: Provider
  protected host: string
  protected apiKey: string

  constructor(provider: Provider) {
    this.provider = provider
    this.host = this.getBaseURL()
    this.apiKey = this.getApiKey()
  }

  abstract completions({ messages, assistant, onChunk, onFilterMessages }: CompletionsParams): Promise<void>
  abstract translate(message: Message, assistant: Assistant, onResponse?: (text: string) => void): Promise<string>
  abstract summaries(messages: Message[], assistant: Assistant): Promise<string>
  abstract suggestions(messages: Message[], assistant: Assistant): Promise<Suggestion[]>
  abstract generateText({ prompt, content }: { prompt: string; content: string }): Promise<string>
  abstract check(model: Model): Promise<{ valid: boolean; error: Error | null }>
  abstract models(): Promise<OpenAI.Models.Model[]>
  abstract generateImage(params: GenerateImageParams): Promise<string[]>
  abstract getEmbeddingDimensions(model: Model): Promise<number>

  public getBaseURL(): string {
    const host = this.provider.apiHost
    return host.endsWith('/') ? host : `${host}/v1/`
  }

  public getApiKey() {
    const keys = this.provider.apiKey.split(',').map((key) => key.trim())
    const keyName = `provider:${this.provider.id}:last_used_key`

    if (keys.length === 1) {
      return keys[0]
    }

    const lastUsedKey = window.keyv.get(keyName)
    if (!lastUsedKey) {
      window.keyv.set(keyName, keys[0])
      return keys[0]
    }

    const currentIndex = keys.indexOf(lastUsedKey)
    const nextIndex = (currentIndex + 1) % keys.length
    const nextKey = keys[nextIndex]
    window.keyv.set(keyName, nextKey)

    return nextKey
  }

  public defaultHeaders() {
    return {
      'X-Api-Key': this.apiKey
    }
  }

  public get keepAliveTime() {
    return this.provider.id === 'ollama'
      ? getOllamaKeepAliveTime()
      : this.provider.id === 'lmstudio'
        ? getLMStudioKeepAliveTime()
        : undefined
  }

  public async fakeCompletions({ onChunk }: CompletionsParams) {
    for (let i = 0; i < 100; i++) {
      await delay(0.01)
      onChunk({ text: i + '\n', usage: { completion_tokens: 0, prompt_tokens: 0, total_tokens: 0 } })
    }
  }

  public async getMessageContent(message: Message) {
    if (!message.knowledgeBaseIds) {
      return message.content
    }

    const knowledgeId = message.knowledgeBaseIds[0]
    const base = store.getState().knowledge.bases.find((kb) => kb.id === knowledgeId)

    if (!base) {
      return message.content
    }

    const { referencesContent, referencesCount } = await getKnowledgeReferences(base, message)

    // 如果知识库中未检索到内容则使用通用逻辑
    if (referencesCount === 0) {
      return message.content
    }

    const prompt = base.prompt?.length === 0 ? REFERENCE_PROMPT : base.prompt || REFERENCE_PROMPT
    Logger.debug('[BaseProvider] Prompt template:', prompt)

    const result = prompt.replace('{question}', message.content).replace('{references}', referencesContent)
    Logger.debug('[BaseProvider] Final prompt:', result)

    return result
  }

  protected getCustomParameters(assistant: Assistant) {
    return (
      assistant?.settings?.customParameters?.reduce((acc, param) => {
        if (!param.name?.trim()) {
          return acc
        }
        if (param.type === 'json') {
          const value = param.value as string
          if (value === 'undefined') {
            return { ...acc, [param.name]: undefined }
          }
          return { ...acc, [param.name]: isJSON(value) ? parseJSON(value) : value }
        }
        return {
          ...acc,
          [param.name]: param.value
        }
      }, {}) || {}
    )
  }
}
