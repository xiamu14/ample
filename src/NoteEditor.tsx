import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal } from '@heroui/react'
import { Node, mergeAttributes, type JSONContent } from '@tiptap/core'
import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { AudioLines, Bold, CheckSquare, ImagePlus, Italic, Link2, List, Play } from 'lucide-react'

const paragraph = (): JSONContent => ({ type: 'paragraph' })
const contentOf = (doc?: JSONContent): JSONContent[] => doc?.type === 'doc' && doc.content?.length ? doc.content : [paragraph()]
const hasContent = (doc?: JSONContent) => Boolean(doc?.content?.some(node => node.type !== 'paragraph' || node.content?.length))
export function toDocument(sections: JSONContent[]): JSONContent {
  if (sections.length === 1 && sections[0]?.type === 'doc') return sections[0]
  const unfinished = contentOf(sections[0])
  const legacy = hasContent(sections[1]) ? [{ type: 'paragraph', content: [{ type: 'text', text: '原有下一步记录', marks: [{ type: 'bold' }] }] }, ...contentOf(sections[1])] : []
  return { type: 'doc', content: [
    { type: 'fixedSection', attrs: { kind: 'unfinished' }, content: [...unfinished, ...legacy] },
    { type: 'fixedSection', attrs: { kind: 'important' }, content: contentOf(sections[2]) },
  ] }
}

function SectionView({ node }: NodeViewProps) {
  const unfinished = node.attrs.kind === 'unfinished'
  return <NodeViewWrapper className="document-section">
    <div className={`document-section-title ${unfinished ? 'unfinished' : 'important'}`} contentEditable={false}><span className="section-label-icon" aria-hidden="true">{unfinished ? '◌' : '✳'}</span><strong>{unfinished ? '未完成的事' : '今日重要的事'}</strong></div>
    <NodeViewContent className="document-section-content" />
  </NodeViewWrapper>
}
const FixedSection = Node.create({
  name: 'fixedSection', content: 'block+', isolating: true, defining: true,
  addAttributes() { return { kind: { default: 'unfinished' } } },
  parseHTML() { return [{ tag: 'section[data-fixed-section]' }] },
  renderHTML({ HTMLAttributes }) { return ['section', mergeAttributes(HTMLAttributes, { 'data-fixed-section': '' }), 0] },
  addNodeView() { return ReactNodeViewRenderer(SectionView) },
})
const Document = Node.create({
  name: 'doc', topNode: true, content: 'fixedSection fixedSection',
  addProseMirrorPlugins() { return [new Plugin({ filterTransaction: tr => { const doc = tr.doc; return doc.childCount === 2 && doc.child(0).type.name === 'fixedSection' && doc.child(0).attrs.kind === 'unfinished' && doc.child(1).type.name === 'fixedSection' && doc.child(1).attrs.kind === 'important' } })] },
})
function TodoView({ node, updateAttributes }: NodeViewProps) {
  return <NodeViewWrapper className="todo-block"><div className="todo-checkbox" contentEditable={false}><Button isIconOnly variant="ghost" aria-label={node.attrs.checked ? '标记未完成' : '标记完成'} aria-pressed={node.attrs.checked} onPress={() => updateAttributes({ checked: !node.attrs.checked })}><span className={`todo-check ${node.attrs.checked ? 'checked' : ''}`}>{node.attrs.checked ? '✓' : ''}</span></Button></div><NodeViewContent className="todo-content" /></NodeViewWrapper>
}
const Todo = Node.create({
  name: 'todoEntry', group: 'block', content: 'paragraph paragraph', defining: true, isolating: true,
  addAttributes() { return { checked: { default: false } } },
  parseHTML() { return [{ tag: 'div[data-todo-entry]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-todo-entry': '' }), 0] },
  addNodeView() { return ReactNodeViewRenderer(TodoView) },
  addKeyboardShortcuts() {
    return { Backspace: () => {
      const { $from, empty } = this.editor.state.selection
      if (!empty || $from.parentOffset !== 0) return false
      let depth = $from.depth
      while (depth > 0 && $from.node(depth).type.name !== 'todoEntry') depth--
      if (!depth || $from.node(depth).child(0).content.size > 0 || $from.node(depth).child(1).content.size > 0) return false
      return this.editor.chain().focus().deleteRange({ from: $from.before(depth), to: $from.after(depth) }).run()
    }, Enter: () => {
      const { $from, empty } = this.editor.state.selection
      if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false
      let depth = $from.depth
      while (depth > 0 && $from.node(depth).type.name !== 'todoEntry') depth--
      if (!depth || $from.depth !== depth + 1) return false
      if ($from.index(depth) === 0) return this.editor.chain().focus().setTextSelection($from.after() + 1).run()
      const next = $from.after(depth)
      return this.editor.chain().focus().insertContentAt(next, { type: 'todoEntry', content: [paragraph(), paragraph()] }).setTextSelection(next + 2).run()
    } }
  },
})
function MediaView({ node, deleteNode }: NodeViewProps) {
  const { src, name, kind, status } = node.attrs
  if (status !== 'ready') return <NodeViewWrapper as="span" className="media-wrap" contentEditable={false}><span className="media-chip media-status">{status === 'failed' ? '上传失败' : '上传中…'} <Button isIconOnly variant="ghost" aria-label="移除媒体" onPress={deleteNode}>×</Button></span></NodeViewWrapper>
  return <NodeViewWrapper as="span" className="media-wrap" contentEditable={false}><span className={`media-chip media-thumbnail media-${kind}`} tabIndex={0} role="button" aria-label={`预览${name}`}>
    {kind === 'image' ? <img src={src} alt="" /> : kind === 'video' ? <><video src={src} preload="metadata" muted playsInline aria-hidden="true" /><Play className="media-play" size={14} fill="currentColor" aria-hidden="true" /></> : <AudioLines size={21} aria-hidden="true" />}
    <span className="media-popover">{kind === 'image' ? <img src={src} alt={name} /> : kind === 'video' ? <video src={src} controls preload="metadata" /> : <audio src={src} controls preload="metadata" />}</span>
  </span></NodeViewWrapper>
}
const Media = Node.create({
  name: 'media', group: 'inline', inline: true, atom: true, draggable: true,
  addAttributes() { return { src: { default: '' }, name: { default: '' }, kind: { default: 'image' }, id: { default: '' }, status: { default: 'ready' } } },
  parseHTML() { return [{ tag: 'span[data-media]' }] },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-media': '' })] },
  addNodeView() { return ReactNodeViewRenderer(MediaView, { as: 'span' }) },
})

type MenuState = { from: number; to: number; x: number; y: number; query: string; section: string }
const commands = [
  { key: 'todo', label: '待办', hint: '将行动与一件待办关联', icon: CheckSquare },
  { key: 'bullet', label: '列表', hint: '创建无序列表', icon: List },
  { key: 'bold', label: '粗体', hint: '突出文字', icon: Bold },
  { key: 'italic', label: '斜体', hint: '倾斜文字', icon: Italic },
  { key: 'link', label: '链接', hint: '插入网页地址', icon: Link2 },
  { key: 'media', label: '附件', hint: '将媒体放入文档', icon: ImagePlus },
]
export function NoteEditor({ initial, onChange, registerUploading, calendarOpen = false }: { initial: JSONContent; onChange: (v: JSONContent) => void; registerUploading: (n: number) => void; calendarOpen?: boolean }) {
  const calendarOpenRef = useRef(calendarOpen); calendarOpenRef.current = calendarOpen
  const changeRef = useRef(onChange); changeRef.current = onChange
  const uploadRef = useRef(registerUploading); uploadRef.current = registerUploading
  const fileRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [active, setActive] = useState(0)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState('')
  const [linkLoading, setLinkLoading] = useState(false)
  const menuState = useRef<MenuState | null>(null); menuState.current = menu
  const activeRef = useRef(active); activeRef.current = active
  const executeRef = useRef<(key: string) => void>(() => {})
  const filtered = (state: MenuState) => commands.filter(c => !(state.section === 'unfinished' && c.key === 'bullet') && !(state.section !== 'unfinished' && c.key === 'todo') && `${c.label} ${c.key}`.toLowerCase().includes(state.query.toLowerCase()))
  const updateMenu = (editor: NonNullable<ReturnType<typeof useEditor>>) => {
    const { $from, empty } = editor.state.selection
    if (calendarOpenRef.current || !empty || !$from.parent.isTextblock) { setMenu(null); return }
    const text = $from.parent.textBetween(0, $from.parentOffset, '\n', '￼')
    const match = /(?:^|\s)\/([^\s/]*)$/.exec(text)
    if (!match) { setMenu(null); return }
    const from = $from.pos - match[1].length - 1
    const coords = editor.view.coordsAtPos(from)
    const section = Array.from({ length: $from.depth + 1 }, (_, i) => $from.node(i)).find(node => node.type.name === 'fixedSection')?.attrs.kind || ''
    setMenu({ from, to: $from.pos, x: Math.min(coords.left, window.innerWidth - 181), y: Math.min(coords.bottom + 8, window.innerHeight - 330), query: match[1], section }); setActive(0)
  }
  const editor = useEditor({
    extensions: [StarterKit.configure({ document: false, link: { openOnClick: true, autolink: true, defaultProtocol: 'https', HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } } }), Document, FixedSection, Todo, Media],
    content: initial,
    editorProps: {
      attributes: { class: 'editor-content unified-editor', 'aria-label': '每日笔记' },
      handleKeyDown: (_view, event) => {
        const state = menuState.current; if (!state) return false
        const options = filtered(state)
        if (event.key === 'Escape') { setMenu(null); return true }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((activeRef.current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % (options.length || 1)); return true }
        if (event.key === 'Enter' && options.length) { event.preventDefault(); executeRef.current(options[activeRef.current % options.length].key); return true }
        return false
      },
    },
    onUpdate: ({ editor }) => { changeRef.current(editor.getJSON()); updateMenu(editor) },
    onSelectionUpdate: ({ editor }) => updateMenu(editor),
  })
  useEffect(() => { if (calendarOpen) setMenu(null) }, [calendarOpen])
  useEffect(() => { const outside = (event: PointerEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as globalThis.Node) && !(event.target as Element).closest('.unified-editor')) setMenu(null) }; document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside) }, [])
  const upload = async (files: FileList | File[], position?: number) => {
    if (!editor) return
    const list = Array.from(files).filter(f => /^(image|audio|video)\//.test(f.type)); if (!list.length) return
    const items = list.map(file => ({ file, id: crypto.randomUUID() }))
    const pos = position === undefined ? editor.state.selection.from : Math.min(position, editor.state.doc.content.size)
    editor.chain().focus().insertContentAt(pos, items.map(({ file, id }) => ({ type: 'media', attrs: { id, name: file.name, kind: file.type.split('/')[0], status: 'uploading' } }))).run()
    uploadRef.current(list.length)
    await Promise.all(items.map(async ({ file, id }) => {
      let attrs: Record<string, string>
      try { const data = new FormData(); data.append('file', file); const response = await fetch('/api/media', { method: 'POST', body: data }); if (!response.ok) throw new Error(); const item = await response.json(); attrs = { id, src: item.url, name: item.name, kind: item.type.split('/')[0], status: 'ready' } }
      catch { attrs = { id, name: file.name, kind: file.type.split('/')[0], status: 'failed' } }
      let found: number | undefined; editor.state.doc.descendants((node, at) => { if (node.type.name === 'media' && node.attrs.id === id) found = at })
      if (found !== undefined && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setNodeMarkup(found, undefined, attrs))
      uploadRef.current(-1)
    }))
  }
  executeRef.current = (key: string) => {
    if (!editor || !menuState.current) return
    const { from, to } = menuState.current
    const selection = editor.state.doc.resolve(from)
    const section = Array.from({ length: selection.depth + 1 }, (_, i) => selection.node(i)).find(n => n.type.name === 'fixedSection')
    if (key === 'todo' && section?.attrs.kind !== 'unfinished') { setMenu(null); window.alert('待办和下一步请记录在“未完成的事”中。'); return }
    editor.chain().focus().deleteRange({ from, to }).run(); setMenu(null)
    if (key === 'todo') editor.chain().focus().insertContent({ type: 'todoEntry', content: [paragraph(), paragraph()] }).run()
    if (key === 'bullet') editor.chain().focus().toggleBulletList().run()
    if (key === 'bold') editor.chain().focus().toggleBold().run()
    if (key === 'italic') editor.chain().focus().toggleItalic().run()
    if (key === 'media') fileRef.current?.click()
    if (key === 'link') { setLinkUrl(''); setLinkError(''); setLinkOpen(true) }
  }
  const insertLink = async () => {
    const url = linkUrl.trim()
    let parsed: URL
    try {
      parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error()
    } catch { setLinkError('请输入有效的 HTTP 或 HTTPS 链接。'); return }
    if (!editor || linkLoading) return
    setLinkLoading(true)
    let title = ''
    try {
      const response = await fetch('/api/link-title', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      if (response.ok) {
        const result = await response.json()
        title = new DOMParser().parseFromString(result.title || '', 'text/html').documentElement.textContent?.trim() || ''
      }
    } catch { title = '' }
    if (!editor.isDestroyed) editor.chain().insertContent({ type: 'text', text: title || parsed.hostname, marks: [{ type: 'link', attrs: { href: url } }] }).run()
    setLinkLoading(false); setLinkOpen(false)
    requestAnimationFrame(() => { if (!editor.isDestroyed) editor.commands.focus() })
  }
  return <div className="unified-shell" onDragOver={e => { if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault() }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); const pos = editor?.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos; void upload(e.dataTransfer.files, pos) } }}>
    <EditorContent editor={editor}/>
    <Modal.Backdrop isOpen={linkOpen} isDismissable={!linkLoading} isKeyboardDismissDisabled={linkLoading} onOpenChange={open => { if (!linkLoading) setLinkOpen(open) }}>
      <Modal.Container size="sm" placement="center" className="link-modal">
        <Modal.Dialog>
          <form onSubmit={event => { event.preventDefault(); insertLink() }}>
            <Modal.Header><Modal.Heading>插入链接</Modal.Heading></Modal.Header>
            <Modal.Body>
              <Input autoFocus aria-label="链接地址" aria-invalid={Boolean(linkError)} aria-describedby={linkError ? 'link-error' : undefined} placeholder="https://" value={linkUrl} onChange={event => { setLinkUrl(event.target.value); setLinkError('') }} />
              {linkError && <span id="link-error" className="link-error" role="alert">{linkError}</span>}
            </Modal.Body>
            <Modal.Footer><Button size="sm" variant="ghost" isDisabled={linkLoading} onPress={() => setLinkOpen(false)}>取消</Button><Button size="sm" type="submit" isDisabled={linkLoading} className="link-submit">{linkLoading ? '读取中…' : '插入'}</Button></Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
    <input ref={fileRef} hidden type="file" multiple accept="image/*,audio/*,video/*" onChange={e => { if (e.target.files) void upload(e.target.files); e.target.value = '' }}/>
    {menu && <div ref={menuRef} className="slash-menu" style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }} role="listbox" aria-label="编辑命令">{filtered(menu).length ? filtered(menu).map((command, i) => <Button key={command.key} variant="ghost" className={`slash-option ${i === active ? 'selected' : ''}`} onMouseEnter={() => setActive(i)} onPress={() => executeRef.current(command.key)}><span className="slash-icon"><command.icon size={16}/></span><span><strong>{command.label}</strong></span></Button>) : <div className="slash-empty">没有匹配的命令</div>}</div>}
  </div>
}
