import { useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import { Easing, interpolate } from 'remotion'

const FADE_MS = 300
const HOLD_MS = 1200
const ease = Easing.bezier(0.22, 1, 0.36, 1)

type Props = { status: string; error: string; uploading: number; revision: number }

export function SaveStatus({ status, error, uploading, revision }: Props) {
  const [shown, setShown] = useState(false)
  const [progress, setProgress] = useState(0)
  const progressRef = useRef(0)
  const active = Boolean(error || uploading || status !== '已保存')

  useEffect(() => {
    if (active) { setShown(true); return }
    if (revision === 0) { setShown(false); return }
    setShown(true)
    const timer = window.setTimeout(() => setShown(false), HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [active, revision])

  useEffect(() => {
    const from = progressRef.current
    const to = shown ? 1 : 0
    if (from === to) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      progressRef.current = to; setProgress(to); return
    }
    let frame = 0
    let start: number | undefined
    const tick = (now: number) => {
      start ??= now
      const elapsed = Math.min((now - start) / FADE_MS, 1)
      const next = interpolate(elapsed, [0, 1], [from, to], { easing: ease })
      progressRef.current = next; setProgress(next)
      if (elapsed < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [shown])

  const text = uploading ? '上传中' : error && status === '已保存' ? '状态异常' : status
  return <span className={`save-status ${error ? 'error' : ''}`} aria-live="polite" aria-hidden={progress === 0 && !shown} style={{ opacity: progress, visibility: progress === 0 && !shown ? 'hidden' : 'visible', transform: `translateY(${(1 - progress) * 4}px)` }}>
    {uploading || status === '保存中' || status === '等待保存' ? <LoaderCircle size={14} className="spin"/> : error || status === '未保存' ? <CircleAlert size={14}/> : <Check size={14}/>} {text}
  </span>
}
