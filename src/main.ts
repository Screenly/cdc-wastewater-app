import {
  getSettingWithDefault,
  readEdgeAppCache,
  reportError,
  setupErrorHandling,
  setupSentry,
  signalReady,
  writeEdgeAppCache,
} from '@screenly/edge-apps'

import { requestSkip } from './player'
import {
  resolveLocale,
  resolveScope,
  resolveTheme,
  showCachedData,
  skipWhenUnreachable,
} from './settings'
import {
  card,
  countyPhrase,
  formatDate,
  formatNumber,
  legend,
  setLocale,
} from './render'
import {
  countsUrl,
  everUrl,
  rowsOf,
  reasonOf,
  siteUrl,
  summarize,
  type Scope,
  type Summary,
} from './cdc'

interface SiteInfo {
  counties: string
  state: string
  population: number | null
}

interface Cached {
  scope: string
  summary: Summary
  site: SiteInfo | null
}

const CACHE_NAMESPACE = 'cdc-wastewater-app'
const CACHE_KEY = 'summary'

const STALE_MS = 21 * 24 * 60 * 60 * 1000

// Looked up in start(), not here. The bundle is inlined into <head> as a
// classic script, so module scope runs before <body> exists.
let stage!: HTMLElement

let scope: Scope = { kind: 'nation' }

function say(id: string, text: string): void {
  document.getElementById(id)!.textContent = text
}

function placeOf(site: SiteInfo | null): { place: string; area: string } {
  switch (scope.kind) {
    case 'nation':
      return { place: 'United States', area: '' }
    case 'state':
      return { place: scope.state, area: '' }
    case 'county':
      return {
        place: `${countyPhrase(scope.county, scope.state)}, ${scope.state}`,
        area: '',
      }
    case 'site': {
      const place = `Sewershed ${scope.site.replace('ID:', '')}`
      if (!site) return { place, area: '' }
      const served =
        site.population === null
          ? ''
          : ` · serves about ${formatNumber(site.population)} people`
      return {
        place,
        area: `${countyPhrase(site.counties, site.state)}, ${site.state}${served}`,
      }
    }
  }
}

function show(summary: Summary, site: SiteInfo | null): void {
  stage.className = ''
  const { place, area } = placeOf(site)
  say('place', place)
  say('area', area)

  const week = formatDate(summary.weekEnd, true)
  const stale =
    Date.now() - Date.parse(`${summary.weekEnd}T00:00:00Z`) > STALE_MS
  const sites =
    scope.kind === 'site'
      ? ''
      : ` · ${formatNumber(summary.sites)} ${summary.sites === 1 ? 'site' : 'sites'} reporting`
  say(
    'week',
    `${stale ? 'Latest report: week' : 'Week'} ending ${week}${sites}`,
  )
  say(
    'updated',
    summary.updated ? ` · updated ${formatDate(summary.updated, false)}` : '',
  )

  document.getElementById('cards')!.replaceChildren(...summary.series.map(card))
}

function message(className: string, lede: string, detail: string): void {
  stage.className = className
  for (const id of ['place', 'area', 'week', 'updated']) say(id, '')
  say('lede', lede)
  say('detail', detail)
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`CDC returned ${response.status}${reasonOf(body)}`)
  }
  return body
}

async function siteInfo(timeoutMs: number): Promise<SiteInfo | null> {
  if (scope.kind !== 'site') return null
  const body = await getJson(siteUrl(scope.site), timeoutMs)
  const row = Array.isArray(body) ? (body[0] as Record<string, unknown>) : null
  if (typeof row?.counties !== 'string' || typeof row.state !== 'string') {
    return null
  }
  const population = Number(row.population)
  return {
    counties: row.counties,
    state: row.state,
    population:
      Number.isFinite(population) && population > 0 ? population : null,
  }
}

type Empty = 'unknown' | 'quiet'

/**
 * After an empty answer: has this place ever reported? A failed check counts
 * as "quiet", the milder message, rather than calling a real place unknown.
 */
async function emptyKind(timeoutMs: number): Promise<Empty> {
  if (scope.kind === 'nation') return 'quiet'
  try {
    const rows = rowsOf(await getJson(everUrl(scope), timeoutMs))
    return rows === 0 ? 'unknown' : 'quiet'
  } catch {
    return 'quiet'
  }
}

/**
 * The try covers the fetch and parse only: a fault in the drawing is not a
 * fetch failure and must not be answered by falling back to cache.
 */
async function current(first: boolean): Promise<Cached | Empty | null> {
  // The screenshotter gives the page 10s to go quiet and 10s more for the
  // ready signal. Timing out well inside that leaves room to fall back.
  const fetchTimeoutMs = 8000
  const key = JSON.stringify(scope)
  let summary: Summary | null
  let site: SiteInfo | null
  try {
    // data.cdc.gov sends Access-Control-Allow-Origin: *, so no CORS proxy.
    // The site's description only names it, so its failure is not the data's.
    ;[summary, site] = await Promise.all([
      getJson(countsUrl(scope, Date.now()), fetchTimeoutMs).then(summarize),
      siteInfo(fetchTimeoutMs).catch(() => null),
    ])
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown))
    reportError(error, { source: 'cdc-wastewater' })
    if (getSettingWithDefault<boolean>('display_errors', false)) throw error
    // With the cache turned off, a first load falls through to skip or the
    // message. A refresh keeps it, so a playing screen never turns to an error.
    if (first && !showCachedData()) return null
    // A summary only means something for the place it was fetched for.
    const cached = readEdgeAppCache<Cached>(CACHE_NAMESPACE, CACHE_KEY)
    return cached?.scope === key ? cached : null
  }
  if (!summary) return emptyKind(fetchTimeoutMs)
  const fresh: Cached = { scope: key, summary, site }
  writeEdgeAppCache(CACHE_NAMESPACE, CACHE_KEY, fresh)
  return fresh
}

function unknownText(): [string, string] {
  if (scope.kind === 'site') {
    const id = scope.site.replace('ID:', '')
    return ['No site found', `CDC has no wastewater site with ID ${id}`]
  }
  if (scope.kind === 'county') {
    return [
      'No sites found',
      `CDC has no wastewater site serving ${placeOf(null).place}. Check the spelling.`,
    ]
  }
  const { place } = placeOf(null)
  return ['No sites found', `CDC has no wastewater sites in ${place}`]
}

/**
 * The approved failure-mode algorithm.
 *
 *   fetch -> ok        : cache it, show it
 *         -> no rows   : ever reported ? (skip setting ? abort : say quiet)
 *                                    : say no sites match the setting
 *         -> failed    : display_errors ? show the error
 *                                       : cached ? show that : abort
 *
 * Aborting only happens on the first load, before the ready signal. Returns
 * true when the player was asked to skip the app.
 */
async function load(first: boolean): Promise<boolean> {
  const result = await current(first)
  if (result === 'unknown') {
    // Never skipped: a misspelt county should be seen and fixed.
    message('empty', ...unknownText())
  } else if (result === 'quiet') {
    const skip = getSettingWithDefault<boolean>('skip_when_no_data', false)
    if (first && skip && requestSkip()) return true
    const { place, area } = placeOf(null)
    const where = area ? `${place}, ${area}` : place
    message(
      'empty',
      'No recent reports',
      `CDC has no wastewater data for ${where} in the last few months`,
    )
  } else if (result) {
    show(result.summary, result.site)
  } else {
    // The Abort terminal. Without a skip, still signal ready: an app that never
    // signals stalls the playlist for 60s.
    if (first && skipWhenUnreachable() && requestSkip()) return true
    message(
      'unavailable',
      'Unavailable',
      'CDC data could not be reached and nothing is cached',
    )
  }
  return false
}

async function start(): Promise<void> {
  setupSentry('cdc-wastewater-app')
  setupErrorHandling()

  stage = document.getElementById('stage') as HTMLElement
  document.documentElement.dataset.theme = resolveTheme()
  setLocale(resolveLocale())
  document.getElementById('legend')!.replaceChildren(...legend())

  // A setting that cannot work is said on screen, not thrown: it is something
  // to fill in, not a fault.
  const resolved = resolveScope()
  if ('problem' in resolved) {
    message('unconfigured', resolved.problem, resolved.detail)
    signalReady()
    return
  }
  scope = resolved.scope

  // An aborted app is being torn down: no ready signal, no refresh.
  if (await load(true)) return
  signalReady()

  // CDC publishes once a week, on Fridays. Hourly costs one ~20 KB request
  // and picks the new week up within the hour.
  const refreshMs = 60 * 60 * 1000
  setInterval(() => void load(false), refreshMs)
}

document.addEventListener('DOMContentLoaded', () => void start())
