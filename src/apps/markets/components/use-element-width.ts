/**
 * @file use-element-width.ts
 * @description The rendered width of an element, tracked with a
 * ResizeObserver; `fallback` until the first measurement (and in test DOMs
 * that do not lay out).
 */
import { useEffect, useRef, useState, type RefObject } from 'react'

export function useElementWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const measured = Math.floor(entries[0]?.contentRect.width ?? 0)
      if (measured > 0) setWidth(measured)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])
  return [ref, width]
}
