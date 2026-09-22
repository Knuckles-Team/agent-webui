/**
 * Release gate for the runtime site configuration.
 *
 * This imports the same TypeScript validator used by the UI instead of
 * maintaining a second legal/contact policy in a Node-only script. Node 22+
 * type stripping is used deliberately so the release path exercises the real
 * `validateSiteConfig` implementation.
 */
const { getSiteConfig, validateSiteConfig } = await import('../src/lib/site-config.ts')

const config = getSiteConfig()
if (!config.indexableEnvironment) {
  console.log('site config check passed (safe noindex mode; public publication metadata is not required)')
} else {
  const validation = validateSiteConfig(config)
  if (validation.valid) {
    console.log('site config check passed (public origin, legal identity, and reviewed content configured)')
  } else {
    console.error(`site config check failed (${validation.errors.length} issue(s))`)
    for (const error of validation.errors) console.error(`- ${error}`)
    process.exitCode = 1
  }
}
