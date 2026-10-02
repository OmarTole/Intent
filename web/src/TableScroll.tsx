import { useLayoutEffect, useRef, type ReactNode } from 'react'
import './table-scroll.css'

export default function TableScroll({ children, centerKey }: { children: ReactNode; centerKey?: string }) {
  const topRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (centerKey === undefined) return
    const center = () => {
      const content = contentRef.current!, top = topRef.current!
      const target = content.querySelector<HTMLElement>('[data-center]')
      const pinned = content.querySelector<HTMLElement>('thead th:first-child')
      if (!target || !content.clientWidth) return
      const pinnedWidth = pinned?.getBoundingClientRect().width || 0
      const targetCenter = target.getBoundingClientRect().left - content.getBoundingClientRect().left + content.scrollLeft + target.getBoundingClientRect().width / 2
      content.scrollLeft = Math.max(0, targetCenter - pinnedWidth - (content.clientWidth - pinnedWidth) / 2)
      top.scrollLeft = content.scrollLeft
    }
    // A fullscreen dialog becomes measurable after showModal in its parent.
    const frame = requestAnimationFrame(center)
    window.addEventListener('resize', center)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', center) }
  }, [centerKey])

  useLayoutEffect(() => {
    const top = topRef.current!, content = contentRef.current!, spacer = spacerRef.current!
    const measure = () => {
      if (centerKey !== undefined) {
        const width = content.querySelector('thead th:first-child')?.getBoundingClientRect().width || 0
        content.style.setProperty('--tracker-edge-space', `${Math.max(0, (content.clientWidth - width - 38) / 2)}px`)
      }
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
