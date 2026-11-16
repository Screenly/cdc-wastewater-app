import { test } from '@playwright/test'
import {
  captureScreenshot,
  createMockScreenlyForScreenshots,
} from '@screenly/edge-apps/test/screenshots'
import { readFileSync } from 'fs'
import path from 'path'

/**
 * Fixtures are real CDC answers for each state, moved back in whole weeks so
 * the latest week ends just before the library's fixed screenshot clock.
 */
const fixture = (name: string): string =>
  readFileSync(
    path.join(import.meta.dirname, 'fixtures', `${name}.json`),
    'utf8',
  )

const STATES = [
  { name: 'california', state: 'California', theme: 'light' },
  { name: 'texas', state: 'Texas', theme: 'light' },
  { name: 'new-york', state: 'New York', theme: 'dark' },
] as const

const RESOLUTIONS = [
  { width: 1920, height: 1080 },
  { width: 1080, height: 1920 },
] as const

for (const { name, state, theme } of STATES) {
  const { screenlyJsContent } = createMockScreenlyForScreenshots(
    {},
    { state, theme_mode: theme, override_locale: 'en' },
  )
  const body = fixture(name)

  for (const { width, height } of RESOLUTIONS) {
    test(`screenshot ${name} ${width}x${height}`, async ({ browser }) => {
      await captureScreenshot(browser, {
        width,
        height,
        filenamePrefix: name,
        screenlyJsContent,
        setupMocks: async (page) => {
          await page.route(/data\.cdc\.gov\/resource\//, (route) =>
            route.fulfill({ contentType: 'application/json', body }),
          )
        },
      })
    })
  }
}
