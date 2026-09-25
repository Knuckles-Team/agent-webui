/**
 * @file location.ts
 * @description The current in-app path and search, kept in step with the
 * shell's `history-state-changed`/`popstate` navigation, for app pages that
 * read their own route params and view state from the URL.
 */
import { useEffect, useState } from 'react'

export interface AppLocation {
  pathname: string
  search: URLSearchParams
}

function read(): AppLocation {
  return { pathname: window.location.pathname, search: new URLSearchParams(window.location.search) }
}

export function useAppLocation(): AppLocation {
  const [location, setLocation] = useState(read)
  useEffect(() => {
    const update = () => {
      setLocation(read())
    }
    window.addEventListener('history-state-changed', update)
    window.addEventListener('popstate', update)
    return () => {
      window.removeEventListener('history-state-changed', update)
      window.removeEventListener('popstate', update)
    }
  }, [])
  return location
}

/** Push an in-app path (with optional search) the way the shell's links do. */
export function navigateInApp(path: string): void {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new Event('history-state-changed'))
}

/** Replace the search string of the current path without adding history. */
export function replaceSearch(search: URLSearchParams): void {
  const query = search.toString()
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
}

/** The decoded param of a `/prefix/:param` path, or null when it does not match. */
export function pathParam(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(`${prefix}/`)) return null
  const rest = pathname.slice(prefix.length + 1)
  if (!rest || rest.includes('/')) return null
  try {
    return decodeURIComponent(rest)
  } catch {
    return null
  }
}
