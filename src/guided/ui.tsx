import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

import { format } from './format'
export function Title({ eyebrow, title, children }: {eyebrow: string; title: string; children?: ReactNode}) {
  return <header className="s-title"><span className="s-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{children}</p></header>
}
export function Takeaway({children}: {children: ReactNode}) { return <p className="s-takeaway">{children}</p> }
export function Panel({label, children, className = ''}: {label: string; children: ReactNode; className?: string}) {
  return <section className={`s-panel ${className}`}><span className="s-label">{label}</span>{children}</section>
}
export function Vector({values, label = 'Vetor'}: {values: number[]; label?: string}) {
  return <div className="s-vector"><span className="s-label">{label} · {values.length} dimensões</span><div className="s-vector-values">{values.slice(0, 4).map((value, i) => <div key={i}><small>d{i+1}</small><code>{format(value)}</code></div>)}<span>…</span></div><small>4 componentes exibidas; todas as {values.length} são usadas na comparação.</small></div>
}
export function Modal({title, close, children}: {title: string; close: () => void; children: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog className="s-modal" ref={ref} onCancel={close}><header><h2>{title}</h2><button onClick={close} aria-label="Fechar detalhes"><X size={20}/></button></header><div>{children}</div></dialog>
}
