/**
 * Release gate for the runtime site configuration.
 *
 * This imports the same TypeScript validator used by the UI instead of
 * maintaining a second legal/contact policy in a Node-only script. Node 22+
 * type stripping is used deliberately so the release path exercises the real
 * `validateSiteConfig` implementation.
 */
const { validateSiteConfig } = await import('../src/lib/site-config.ts')

const validation = validateSiteConfig()
if (!validation.valid) {
  console.error(`site config check failed (${validation.errors.length} issue(s))`)
  for (const error of validation.errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log('site config check passed (legal identity, canonical origin, and reviewed content configured)')
}
