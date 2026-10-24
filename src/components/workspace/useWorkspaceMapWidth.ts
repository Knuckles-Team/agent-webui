import { useLayoutEffect, useRef, useState } from 'react'

const storageKey = 'agent-webui.workspace-map-width'
export const mapMinimum = 12
const mapMaximum = 22

function bounded(value: number, maximum = mapMaximum) {
  return Math.min(maximum, Math.max(mapMinimum, value))
}
function savedWidth() {
  try {
    const value = Number(localStorage.getItem(storageKey))
    return value > 0 && Number.isFinite(value) ? bounded(value) : 14
  } catch {
    return 14
  }
}
function rememberWidth(value: number) {
  try {
    localStorage.setItem(storageKey, String(bounded(value)))
  } catch {
    // A blocked preference store must not prevent local resizing.
  }
}

/** Store only a bounded presentation preference; no navigation or task state. */
export function useWorkspaceMapWidth(frame: HTMLElement | null) {
  const [preferred, setPreferred] = useState(savedWidth)
  const [geometry, setGeometry] = useState({ rem: 16, width: 1024 })
  const latest = useRef(preferred)
  useLayoutEffect(() => {
    if (!frame) return
    function measure() {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      setGeometry({ rem, width: frame!.clientWidth })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => {
      observer.disconnect()
    }
  }, [frame])
  const maximum = Math.max(mapMinimum, Math.min(mapMaximum, geometry.width / geometry.rem - 24.5))
  const width = bounded(preferred, maximum)
  function resize(value: number) {
    const next = bounded(value, maximum)
    latest.current = next
    setPreferred(next)
  }
  function save() {
    rememberWidth(latest.current)
  }
  return { width, maximum, rem: geometry.rem, resize, save }
}
