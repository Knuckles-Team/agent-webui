import { defineConfig } from '@playwright/test'
import shared from './canopy-glass.config'

export default defineConfig({
  ...shared,
  testMatch: ['explore-graph.browser.ts'],
  outputDir: '../test-results/explore-graph',
})
