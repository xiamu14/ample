import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Calendar, Popover } from '@heroui/react'
import { parseDate as parseCalendarDate } from '@internationalized/date'
import { I18nProvider } from 'react-aria-components'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { JSONContent } from '@tiptap/core'
import { NoteEditor, toDocument } from './NoteEditor'
import { SaveStatus } from './SaveStatus'
import { CalendarDays, ChevronDown } from 'lucide-react'
import './style.css'

type Note = { date: string; sections: JSONContent[]; version: number; updatedAt: string }
const empty = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] })
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const parseDate = (s: string) => new Date(`${s}T12:00:00`)
const shiftDate = (s: string, n: number) => { const d = parseDate(s); d.setDate(d.getDate() + n); return localDate(d) }
const formatDate = (s: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('zh-CN', opts).format(parseDate(s))
const queryClient = new QueryClient()

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) throw new Error(response.status === 409 ? '这篇笔记已在其他页面修改，请复制当前内容后刷新。' : '连接失败，请检查本地服务后重试。')
  return response.json()
}

function App() {
  const client = useQueryClient()
  const [today, setToday] = useState(localDate)
  const [selected, setSelected] = useState(localDate)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [sections, setSections] = useState<JSONContent[] | null>(null)
  const [status, setStatus] = useState('已保存')
  const [saveRevision, setSaveRevision] = useState(0)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(0)
  const current = useRef<{ date: string; version: number; sections: JSONContent[]; dirty: boolean; saving: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { data: note, isError, isLoading } = useQuery({ queryKey: ['note', selected], queryFn: () => request<Note>(`/api/notes/${selected}`), retry: false })
  const { data: dates = [] } = useQuery({ queryKey: ['dates'], queryFn: () => request<string[]>('/api/notes'), retry: false })
  useEffect(() => { const check = () => { const next = localDate(); setToday(next); void client.fetchQuery({ queryKey: ['note', next], queryFn: () => request<Note>(`/api/notes/${next}`) }).then(() => client.invalidateQueries({ queryKey: ['dates'] })).catch(() => {}) }; check(); const interval = setInterval(check, 60000); window.addEventListener('focus', check); return () => { clearInterval(interval); window.removeEventListener('focus', check) } }, [client])
  useEffect(() => { if (note && note.date === selected && current.current?.date !== selected) { current.current = { date: note.date, version: note.version, sections: [toDocument(note.sections || [])], dirty: false, saving: false }; setSections(current.current.sections); setStatus('已保存'); setError('') } }, [note, selected])
  const save = useCallback(async (): Promise<boolean> => {
    const state = current.current
    if (!state) return true
    if (state.saving) return false
    if (!state.dirty) return true
    state.saving = true; state.dirty = false; const snapshot = state.sections
    setStatus('保存中')
    try {
      const saved = await request<Note>(`/api/notes/${state.date}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sections: snapshot, version: state.version }) })
      state.version = saved.version; state.saving = false; client.setQueryData(['note', state.date], saved); setError('')
      if (state.dirty) return await save()
      setStatus('已保存'); setSaveRevision(value => value + 1); void client.invalidateQueries({ queryKey: ['dates'] }); return true
    } catch (e) { state.dirty = true; state.saving = false; setStatus('未保存'); setError(e instanceof Error ? e.message : '保存失败，请重试。'); return false }
  }, [client])
  const change = (index: number, value: JSONContent) => {
    const state = current.current; if (!state) return
    state.sections = state.sections.map((section, i) => i === index ? value : section); state.dirty = true; setSections(state.sections); setStatus('等待保存')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void save() }, 700)
  }
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (current.current?.dirty || current.current?.saving || uploading) e.preventDefault() }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [uploading])
  const navigate = async (date: string) => {
    if (uploading) { setError('媒体仍在上传，请等待完成。'); return }
    if (timer.current) clearTimeout(timer.current)
    if (current.current?.saving) { setError('正在保存，请稍后再切换。'); return }
    if (!(await save())) return
    if (date !== selected) { current.current = null; setSections(null); setSelected(date) }
    setCalendarOpen(false); setError('')
  }
  const dateSet = new Set(dates)
  return <main className="main-area note-only">
    <div className="document page-enter">
      <div className="document-topline">
        <I18nProvider locale="zh-CN"><Popover isOpen={calendarOpen} onOpenChange={setCalendarOpen}>
          <Button variant="ghost" className="date-trigger" aria-label="选择日期"><CalendarDays size={16}/>{selected.replaceAll('-', '/')}<ChevronDown size={14}/></Button>
          <Popover.Content className="calendar-popover" placement="bottom start"><Popover.Dialog aria-label="选择笔记日期">
            <Calendar aria-label="选择笔记日期" value={parseCalendarDate(selected)} onChange={date => { if (date) void navigate(date.toString()) }}>
              <Calendar.Header><Calendar.Heading/><Calendar.NavButton slot="previous" aria-label="上个月"/><Calendar.NavButton slot="next" aria-label="下个月"/></Calendar.Header>
              <Calendar.Grid><Calendar.GridHeader>{day => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader><Calendar.GridBody>{date => <Calendar.Cell date={date} className={dateSet.has(date.toString()) ? 'has-note' : undefined}/>}</Calendar.GridBody></Calendar.Grid>
            </Calendar>
            <Button size="sm" variant="ghost" className="calendar-today" onPress={() => void navigate(today)}>今天</Button>
          </Popover.Dialog></Popover.Content>
        </Popover></I18nProvider>
        <SaveStatus status={status} error={error} uploading={uploading} revision={saveRevision}/>
      </div>
      {error && <div className="notice" role="alert">{error} <Button variant="ghost" onPress={() => void save()}>重试保存</Button></div>}
      {isLoading && <div className="loading">正在打开笔记…</div>}{isError && <div className="notice">无法连接本地服务。请确认数据库和应用已经启动。</div>}
      {sections && <NoteEditor key={selected} initial={sections[0]} calendarOpen={calendarOpen} onChange={value => change(0, value)} registerUploading={n => setUploading(count => count + n)}/>}
      <div className="document-footer"><span className="footer-symbol">✳</span><span>为今天留一页。</span></div>
    </div>
  </main>
}
const rootRoute = createRootRoute({ component: App })
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null })
const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) })

declare module '@tanstack/react-router' { interface Register { router: typeof router } }
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider></React.StrictMode>)
