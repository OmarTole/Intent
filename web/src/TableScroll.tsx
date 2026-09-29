import { useLayoutEffect, useRef, type ReactNode } from 'react'
import './table-scroll.css'

export default function TableScroll({ children }: { children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const top = topRef.current!, content = contentRef.current!, spacer = spacerRef.current!
    const measure = () => {
      spacer.style.width = `${content.scrollWidth}px`
      top.hidden = content.scrollWidth <= content.clientWidth
      top.scrollLeft = content.scrollLeft
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(content)
    if (content.firstElementChild) observer?.observe(content.firstElementChild)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  return <>
    <div ref={topRef} className="d-table-top-scroll" tabIndex={0} role="region" aria-label="Прокрутка таблицы влево и вправо" onScroll={e => {
      const content = contentRef.current!
      if (content.scrollLeft !== e.currentTarget.scrollLeft) content.scrollLeft = e.currentTarget.scrollLeft
    }}><div ref={spacerRef} /></div>
    <div ref={contentRef} className="d-table-scroll" onScroll={e => {
      const top = topRef.current!
      if (top.scrollLeft !== e.currentTarget.scrollLeft) top.scrollLeft = e.currentTarget.scrollLeft
    }}>{children}</div>
  </>
}
