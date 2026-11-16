import { getSettingWithDefault } from '@screenly/edge-apps'

import { normalizeCounty, normalizeSite, type Scope } from './cdc'
import { findState } from './states'

/**
 * A text setting, trimmed. A blank setting can arrive as null rather than as
 * its default (the dev server does this), so null reads as the fallback.
 */
function text(key: string, fallback: string): string {
  const value = getSettingWithDefault<string | null>(key, fallback)
  return (value ?? fallback).toString().trim() || fallback
}

export type Resolved = { scope: Scope } | { problem: string; detail: string }

/**
 * What the screen reports on. A sewershed ID wins, then a county (which needs
 * a state, as county names repeat across states), then a state, and with none
 * of those, the whole country.
 */
export function resolveScope(): Resolved {
  const siteSetting = text('site_id', '')
  if (siteSetting) {
    const site = normalizeSite(siteSetting)
    if (!site) {
      return {
        problem: 'Sewershed ID not recognised',
        detail: `"${siteSetting}" should be a number, like 112`,
      }
    }
    return { scope: { kind: 'site', site } }
  }

  const stateSetting = text('state', '')
  // Blank is the whole country. "all" was the dropdown's value before State
  // became a text field, so a screen set up with it keeps working.
  const blank = ['', 'all'].includes(stateSetting.toLowerCase())
  const state = blank ? '' : findState(stateSetting)
  if (state === null) {
    return {
      problem: 'State not recognised',
      detail: `"${stateSetting}" is not a US state or territory. Use a name like California or a code like CA.`,
    }
  }
  const county = normalizeCounty(text('county', ''))

  if (county && !state) {
    return {
      problem: 'Choose a state',
      detail: `Pick the state ${county} is in, as county names repeat`,
    }
  }
  if (county) return { scope: { kind: 'county', state, county } }
  if (state) return { scope: { kind: 'state', state } }
  return { scope: { kind: 'nation' } }
}

export function resolveTheme(): 'light' | 'dark' {
  return text('theme_mode', 'light').toLowerCase() === 'dark' ? 'dark' : 'light'
}

export function showCachedData(): boolean {
  return text('show_cached_data', 'true') !== 'false'
}

export function skipWhenUnreachable(): boolean {
  return text('when_unreachable', 'skip') !== 'message'
}

/**
 * The locale the numbers and dates are written in. An unrecognised code stays
 * English. Resolved here rather than with getLocale(), which geocodes the
 * player's coordinates and pulls in a chunk this single-file app does not ship.
 */
export function resolveLocale(): string {
  const requested = text('override_locale', 'en').replaceAll('_', '-')
  if (!requested) return 'en'
  try {
    const resolved = new Intl.DateTimeFormat(requested).resolvedOptions().locale
    const wanted = requested.toLowerCase().split('-')[0]
    const got = resolved.toLowerCase().split('-')[0]
    if (wanted === got) return requested
  } catch {
    // Unrecognised locale: keep English.
  }
  console.warn(`Invalid locale override: "${requested}"`)
  return 'en'
}
