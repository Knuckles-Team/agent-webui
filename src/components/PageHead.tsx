import { useEffect } from 'react'
import { NOT_FOUND_ROUTE, type RouteDef } from '@/lib/nav-registry'
import { projectPageHead } from '@/lib/page-metadata'

const MANAGED_ATTRIBUTE = 'data-agent-webui-head'

function upsertMeta(name: string, content: string): void {
  const matches = Array.from(document.head.querySelectorAll<HTMLMetaElement>(`meta[name="${name}"]`))
  let element = matches.at(0)
  if (!element) {
    element = document.createElement('meta')
    element.name = name
    element.setAttribute(MANAGED_ATTRIBUTE, 'true')
    document.head.appendChild(element)
  } else {
    matches.slice(1).forEach((duplicate) => {
      duplicate.remove()
    })
  }
  element.content = content
}

function upsertProperty(property: string, content: string): void {
  const matches = Array.from(document.head.querySelectorAll<HTMLMetaElement>(`meta[property="${property}"]`))
  let element = matches.at(0)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute('property', property)
    element.setAttribute(MANAGED_ATTRIBUTE, 'true')
    document.head.appendChild(element)
  } else {
    matches.slice(1).forEach((duplicate) => {
      duplicate.remove()
    })
  }
  element.content = content
}

function upsertLink(rel: string, href: string): void {
  const matches = Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`))
  let element = matches.at(0)
  if (!element) {
    element = document.createElement('link')
    element.rel = rel
    element.setAttribute(MANAGED_ATTRIBUTE, 'true')
    document.head.appendChild(element)
  } else {
    matches.slice(1).forEach((duplicate) => {
      duplicate.remove()
    })
  }
  element.href = href
}

function removeManagedHead(): void {
  document.head.querySelectorAll(`[${MANAGED_ATTRIBUTE}]`).forEach((element) => {
    element.remove()
  })
}

/** One projection for title, description, indexability, canonical, and share metadata. */
export function PageHead({ route = NOT_FOUND_ROUTE, pathname }: { route?: RouteDef; pathname?: string }) {
  useEffect(() => {
    const projection = projectPageHead(route, pathname)
    document.title = projection.title
    upsertMeta('description', projection.description)
    upsertMeta('robots', projection.robots)
    upsertMeta('agent-webui-page', projection.webmcpPageId)
    upsertLink('canonical', projection.canonicalUrl)
    // Favicon, Apple touch, and manifest links belong to the static document
    // head. Route transitions must leave that complete size-specific asset set
    // untouched; this component owns only route-varying metadata.

    upsertProperty('og:title', projection.title)
    upsertProperty('og:description', projection.description)
    upsertProperty('og:type', 'website')
    upsertProperty('og:url', projection.canonicalUrl)
    upsertMeta('twitter:card', projection.openGraphImageUrl ? 'summary_large_image' : 'summary')
    if (projection.openGraphImageUrl && projection.openGraphImageAlt) {
      upsertProperty('og:image', projection.openGraphImageUrl)
      upsertProperty('og:image:alt', projection.openGraphImageAlt)
      upsertMeta('twitter:image', projection.openGraphImageUrl)
      upsertMeta('twitter:image:alt', projection.openGraphImageAlt)
    } else {
      document.head
        .querySelectorAll(
          'meta[property="og:image"], meta[property="og:image:alt"], meta[name="twitter:image"], meta[name="twitter:image:alt"]',
        )
        .forEach((element) => {
          element.remove()
        })
    }

    return () => {
      // App owns one long-lived head projection. Clearing on unmount prevents
      // stale metadata in isolated route tests or if the shell is removed.
      removeManagedHead()
    }
  }, [pathname, route])

  return null
}
