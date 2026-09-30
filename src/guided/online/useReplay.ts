import { useEffect, useState } from 'react'
import { replayFrame } from './replayFrame'

/** Presentation clock only. Never triggers model, search or storage work. */
export function useReplay(snapshot: unknown, count: number, interval = 1400) {
  const [frame, setFrame] = useState(0)
  const [run, setRun] = useState(0)
  useEffect(() => {
    if (!snapshot || count < 1) {
      const reset = requestAnimationFrame(() => setFrame(0))
      return () => cancelAnimationFrame(reset)
    }
    // Reduced motion removes movement in CSS, while the content still advances
    // one readable frame at a time. Jumping to the last frame hid the lesson.
    let handle = 0
    const start = performance.now()
    const tick = (now: number) => {
      const next = replayFrame(now, start, count, interval)
      setFrame(next)
      if (next < count - 1) handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [snapshot, count, interval, run])
  return { frame: Math.max(0, Math.min(Math.max(0,count-1),frame)), restart: () => {setFrame(0);setRun(n => n + 1)} }
}
