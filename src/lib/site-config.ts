/**
 * Deployment supplied identity and privacy configuration.
 *
 * Legal identity, contact details, analytics, and the share image are not
 * product defaults. Keeping them in environment configuration lets a build
 * truthfully report that a deployment is incomplete instead of publishing a
 * sample address or silently collecting data.
 */

export interface AnalyticsConfig {
  provider: 'ga4' | 'plausible' | 'custom'
  measurementId: string
  scriptUrl?: string
}

export interface SiteConfig {
  siteName: string
  canonicalOrigin: string | null
  indexableEnvironment: boolean
  openGraphImagePath: string | null
  legalOwner: string | null
  contactAddress: string | null
  contactEmail: string | null
  legalEffectiveDate: string | null
  legalRevision: string | null
  privacyPolicyText: string | null
  termsText: string | null
  analytics: AnalyticsConfig | null
}

export interface SiteConfigValidation {
  valid: boolean
  errors: readonly string[]
}

type Env = Record<string, string | undefined>

function env(): Env {
  // Vite replaces `import.meta.env` at build time. The cast keeps this module
  // easy to exercise in a plain jsdom test. The Node fallback is used only by
  // the release gate, which invokes this same validator outside Vite.
  const viteEnv = (import.meta as unknown as Record<string, unknown>).env
  if (viteEnv && typeof viteEnv === 'object') return viteEnv as Env
  if (typeof process !== 'undefined') return process.env
  return {}
}

function configuredValue(value: string | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

function analyticsConfig(envValues: Env): AnalyticsConfig | null {
  const provider = configuredValue(envValues.VITE_ANALYTICS_PROVIDER)
  const measurementId = configuredValue(envValues.VITE_ANALYTICS_ID)
  if (!provider || !measurementId) return null
  if (provider !== 'ga4' && provider !== 'plausible' && provider !== 'custom') return null
  return {
    provider,
    measurementId,
    ...(configuredValue(envValues.VITE_ANALYTICS_SCRIPT_URL)
      ? { scriptUrl: configuredValue(envValues.VITE_ANALYTICS_SCRIPT_URL)! }
      : {}),
  }
}

/** Read the deployment configuration on demand so tests and runtime config stay deterministic. */
export function getSiteConfig(): SiteConfig {
  const values = env()
  return {
    siteName: configuredValue(values.VITE_SITE_NAME) ?? 'Agent WebUI',
    canonicalOrigin: normalizeOrigin(configuredValue(values.VITE_SITE_ORIGIN)),
    indexableEnvironment:
      configuredValue(values.VITE_SITE_INDEXABLE ?? values.VITE_INDEXABLE_ENVIRONMENT)?.toLowerCase() === 'true',
    // The asset lane supplies this versioned branded image; deployments may
    // override it when they publish under a different asset base path.
    openGraphImagePath: configuredValue(values.VITE_OG_IMAGE_PATH) ?? '/og-image-v1.png',
    legalOwner: configuredValue(values.VITE_LEGAL_OWNER),
    contactAddress: configuredValue(values.VITE_LEGAL_CONTACT_ADDRESS),
    contactEmail: configuredValue(values.VITE_LEGAL_CONTACT_EMAIL),
    legalEffectiveDate: configuredValue(values.VITE_LEGAL_EFFECTIVE_DATE),
    legalRevision: configuredValue(values.VITE_LEGAL_REVISION),
    privacyPolicyText: configuredValue(values.VITE_PRIVACY_POLICY_TEXT),
    termsText: configuredValue(values.VITE_TERMS_TEXT),
    analytics: analyticsConfig(values),
  }
}

/** Public indexing is an explicit deployment choice and requires HTTPS canonical identity. */
export function hasValidIndexableOrigin(config: SiteConfig = getSiteConfig()): boolean {
  return config.indexableEnvironment && config.canonicalOrigin?.startsWith('https://') === true
}

const PLACEHOLDER_PATTERN =
  /(?:example\.(?:com|org|net)|your[-_ ]?(?:company|name|address|email)|placeholder|lorem|changeme|todo|sample)/i

function isRealConfiguredValue(value: string | null): boolean {
  return Boolean(value && !PLACEHOLDER_PATTERN.test(value))
}

interface SiteConfigRule {
  valid: (config: SiteConfig) => boolean
  error: string
}

const SITE_CONFIG_RULES: readonly SiteConfigRule[] = [
  {
    valid: (config) => Boolean(config.canonicalOrigin),
    error: 'VITE_SITE_ORIGIN is missing or is not an http(s) origin',
  },
  {
    valid: (config) => !config.indexableEnvironment || config.canonicalOrigin?.startsWith('https://') === true,
    error: 'VITE_SITE_INDEXABLE=true requires a valid HTTPS VITE_SITE_ORIGIN',
  },
  {
    valid: (config) => isRealConfiguredValue(config.legalOwner),
    error: 'VITE_LEGAL_OWNER is missing or is a placeholder',
  },
  {
    valid: (config) => isRealConfiguredValue(config.contactAddress),
    error: 'VITE_LEGAL_CONTACT_ADDRESS is missing or is a placeholder',
  },
  {
    valid: (config) => isRealConfiguredValue(config.legalEffectiveDate),
    error: 'VITE_LEGAL_EFFECTIVE_DATE is missing or is a placeholder',
  },
  {
    valid: (config) => isRealConfiguredValue(config.legalRevision),
    error: 'VITE_LEGAL_REVISION is missing or is a placeholder',
  },
  {
    valid: (config) => isRealConfiguredValue(config.privacyPolicyText),
    error: 'VITE_PRIVACY_POLICY_TEXT is missing',
  },
  {
    valid: (config) => isRealConfiguredValue(config.termsText),
    error: 'VITE_TERMS_TEXT is missing',
  },
  {
    valid: (config) => Boolean(config.openGraphImagePath),
    error: 'VITE_OG_IMAGE_PATH is missing',
  },
]

/**
 * Release validation intentionally fails when the owner has not supplied legal
 * identity/contact/content. Local development can render an honest unavailable
 * state, while deployment gates can call this function and stop the release.
 */
export function validateSiteConfig(config: SiteConfig = getSiteConfig()): SiteConfigValidation {
  const errors = SITE_CONFIG_RULES.filter((rule) => !rule.valid(config)).map((rule) => rule.error)
  return { valid: errors.length === 0, errors }
}

/** One readiness predicate shared by runtime metadata and static release assets. */
export function isIndexableSiteConfigReady(config: SiteConfig = getSiteConfig()): boolean {
  return hasValidIndexableOrigin(config) && validateSiteConfig(config).valid
}

export function assertSiteConfigReleaseReady(config: SiteConfig = getSiteConfig()): void {
  const validation = validateSiteConfig(config)
  if (!validation.valid) {
    throw new Error(`Agent WebUI site configuration is not release-ready: ${validation.errors.join('; ')}`)
  }
}

export function hasLegalIdentity(config: SiteConfig = getSiteConfig()): boolean {
  return [config.legalOwner, config.contactAddress, config.legalEffectiveDate, config.legalRevision].every(
    isRealConfiguredValue,
  )
}

export function legalDocumentConfigured(kind: 'privacy' | 'terms', config: SiteConfig = getSiteConfig()): boolean {
  return (
    hasLegalIdentity(config) && isRealConfiguredValue(kind === 'privacy' ? config.privacyPolicyText : config.termsText)
  )
}

export function currentOrigin(fallback = 'http://localhost'): string {
  const configured = getSiteConfig().canonicalOrigin
  if (configured) return configured
  if (typeof window !== 'undefined' && window.location.origin) return window.location.origin
  return fallback
}

export function absoluteSiteUrl(path: string, origin = currentOrigin()): string {
  try {
    const absolute = new URL(path)
    if (absolute.protocol === 'http:' || absolute.protocol === 'https:') return absolute.toString()
  } catch {
    // The configured value is normally a relative asset path; fall through to
    // the canonical origin when it is not an absolute URL.
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return new URL(normalizedPath, `${origin.replace(/\/$/, '')}/`).toString()
}
