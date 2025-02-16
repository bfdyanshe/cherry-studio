import { WarningOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { isEmbeddingModel } from '@renderer/config/models'
import { REFERENCE_PROMPT } from '@renderer/config/prompts'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { KnowledgeBase } from '@renderer/types'
import { Alert, Button, Form, FormInstance, Input, InputNumber, Modal, Select, Slider } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { sortBy } from 'lodash'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  base: KnowledgeBase
}

interface FormData {
  name: string
  model: string
  documentCount?: number
  chunkSize?: number
  chunkOverlap?: number
  threshold?: number
  prompt?: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ base: _base, resolve }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm<FormData>()
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { base, updateKnowledgeBase } = useKnowledge(_base.id)
  const textAreaRef = useRef<TextAreaRef>(null)
  const [promptText, setPromptText] = useState('')

  useEffect(() => {
    form.setFieldsValue({
      documentCount: base?.documentCount || 6
    })
    setPromptText(base?.prompt || '') // 初始化知识库提示词输入
  }, [base, form])

  if (!base) {
    resolve(null)
    return null
  }

  const selectOptions = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      label: p.isSystem ? t(`provider.${p.id}`) : p.name,
      title: p.name,
      options: sortBy(p.models, 'name')
        .filter((model) => isEmbeddingModel(model))
        .map((m) => ({
          label: m.name,
          value: getModelUniqId(m)
        }))
    }))
    .filter((group) => group.options.length > 0)

  const onOk = async () => {
    try {
      const values = await form.validateFields()
      const newBase = {
        ...base,
        name: values.name,
        documentCount: values.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT,
        chunkSize: values.chunkSize,
        chunkOverlap: values.chunkOverlap,
        threshold: values.threshold ?? undefined,
        prompt: values.prompt
      }
      updateKnowledgeBase(newBase)
      setOpen(false)
      resolve(newBase)
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  const handleInsertVariable = (form: FormInstance<FormData>, variable: string) => {
    const textArea = textAreaRef.current

    if (!textArea?.resizableTextArea?.textArea) return

    const element = textArea.resizableTextArea.textArea

    // 获取当前光标位置或选区
    const start = element.selectionStart || 0
    const end = element.selectionEnd || 0
    const current = element.value || ''

    // 在光标位置插入变量
    // 如果有选中的文本，会被变量替换
    const newValue = current.substring(0, start) + `{${variable}}` + current.substring(end)

    // 同时更新表单值和受控组件的值
    form.setFieldsValue({ prompt: newValue })
    setPromptText(newValue)

    // 使用 requestAnimationFrame 确保在 DOM 更新后再设置光标位置
    requestAnimationFrame(() => {
      // 恢复焦点并将光标移动到插入的变量后面
      textArea.focus()
      const newPosition = start + variable.length + 2 // +2 是因为要计算 {} 两个字符
      element.setSelectionRange(newPosition, newPosition)
    })
  }

  KnowledgeSettingsPopup.hide = onCancel

  return (
    <Modal
      title={t('knowledge.settings')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      destroyOnClose
      maskClosable={false}
      centered
      style={{ maxHeight: '80vh' }}>
      <Form
        form={form}
        layout="vertical"
        style={{
          maxHeight: 'calc(80vh - 150px)',
          overflowY: 'auto',
          paddingRight: 16,
          marginRight: -8,
          overflowX: 'hidden'
        }}>
        <Form.Item
          name="name"
          label={t('common.name')}
          initialValue={base.name}
          rules={[{ required: true, message: t('message.error.enter.name') }]}>
          <Input placeholder={t('common.name')} />
        </Form.Item>

        <Form.Item
          name="model"
          label={t('models.embedding_model')}
          initialValue={getModelUniqId(base.model)}
          tooltip={{ title: t('models.embedding_model_tooltip'), placement: 'right' }}
          rules={[{ required: true, message: t('message.error.enter.model') }]}>
          <Select style={{ width: '100%' }} options={selectOptions} placeholder={t('settings.models.empty')} disabled />
        </Form.Item>

        <Form.Item
          name="documentCount"
          label={t('knowledge.document_count')}
          tooltip={{ title: t('knowledge.document_count_help') }}>
          <Slider
            style={{ width: '100%' }}
            min={1}
            max={30}
            step={1}
            marks={{ 1: '1', 6: t('knowledge.document_count_default'), 30: '30' }}
          />
        </Form.Item>

        <Form.Item
          name="chunkSize"
          label={t('knowledge.chunk_size')}
          tooltip={{ title: t('knowledge.chunk_size_tooltip') }}
          initialValue={base.chunkSize}
          rules={[
            {
              validator(_, value) {
                const maxContext = getEmbeddingMaxContext(base.model.id)
                if (value && maxContext && value > maxContext) {
                  return Promise.reject(new Error(t('knowledge.chunk_size_too_large', { max_context: maxContext })))
                }
                return Promise.resolve()
              }
            }
          ]}>
          <InputNumber
            style={{ width: '100%' }}
            min={100}
            defaultValue={base.chunkSize}
            placeholder={t('knowledge.chunk_size_placeholder')}
          />
        </Form.Item>

        <Form.Item
          name="chunkOverlap"
          label={t('knowledge.chunk_overlap')}
          initialValue={base.chunkOverlap}
          tooltip={{ title: t('knowledge.chunk_overlap_tooltip') }}
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('chunkSize') > value) {
                  return Promise.resolve()
                }
                return Promise.reject(new Error(t('message.error.chunk_overlap_too_large')))
              }
            })
          ]}
          dependencies={['chunkSize']}>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            defaultValue={base.chunkOverlap}
            placeholder={t('knowledge.chunk_overlap_placeholder')}
          />
        </Form.Item>
        <Form.Item
          name="threshold"
          label={t('knowledge.threshold')}
          tooltip={{ title: t('knowledge.threshold_tooltip') }}
          initialValue={base.threshold}
          rules={[
            {
              validator(_, value) {
                if (value && (value > 1 || value < 0)) {
                  return Promise.reject(new Error(t('knowledge.threshold_too_large_or_small')))
                }
                return Promise.resolve()
              }
            }
          ]}>
          <InputNumber placeholder={t('knowledge.threshold_placeholder')} step={0.1} style={{ width: '100%' }} />
        </Form.Item>

        <Alert
          style={{ margin: '8px 0 16px' }}
          message={t('knowledge.chunk_size_change_warning')}
          type="warning"
          showIcon
          icon={<WarningOutlined />}
        />

        <Form.Item
          name="prompt"
          label={t('knowledge.prompt')}
          initialValue={base.prompt}
          tooltip={{ title: t('knowledge.prompt_tooltip') }}>
          <Input.TextArea
            rows={4}
            placeholder={t('knowledge.prompt_placeholder')}
            ref={textAreaRef}
            value={promptText}
            onChange={(e) => {
              setPromptText(e.target.value)
              form.setFieldsValue({ prompt: e.target.value })
            }}
          />
          <div style={{ marginTop: 8 }}>
            <Button size="small" onClick={() => handleInsertVariable(form, 'question')}>
              插入 {'{question}'}
            </Button>
            <Button style={{ marginLeft: 8 }} size="small" onClick={() => handleInsertVariable(form, 'references')}>
              插入 {'{references}'}
            </Button>
            <Button
              style={{ marginLeft: 8 }}
              size="small"
              onClick={() => {
                navigator.clipboard.writeText(REFERENCE_PROMPT).then(() => {
                  window.message.success('已复制默认模板到剪贴板')
                })
              }}>
              复制默认模板
            </Button>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  )
}

const TopViewKey = 'KnowledgeSettingsPopup'

export default class KnowledgeSettingsPopup {
  static hide() {
    TopView.hide(TopViewKey)
  }

  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
