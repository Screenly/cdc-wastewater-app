/**
 * CDC wastewater viral activity levels, from the NWSS dataset on data.cdc.gov
 * (atcp-73re). The dataset is site-level only: one row per sewershed, virus
 * and week, each with CDC's own category for that site. There are no state or
 * national rows, so this module works them out.
 */

export const DATASET_URL = 'https://data.cdc.gov/resource/atcp-73re.json'

export const LEVELS = ['Very Low', 'Low', 'Moderate', 'High', 'Very High']

export const VIRUSES = [
  { key: 'SARS-CoV-2', label: 'COVID-19', detail: 'SARS-CoV-2' },
  { key: 'Influenza A virus', label: 'Flu', detail: 'Influenza A' },
  { key: 'RSV', label: 'RSV', detail: 'Respiratory syncytial virus' },
] as const

export const WEEKS = 13

const DAY_MS = 24 * 60 * 60 * 1000

export type Scope =
  | { kind: 'nation' }
  | { kind: 'state'; state: string }
  | { kind: 'county'; state: string; county: string }
  | { kind: 'site'; site: string }

export interface CountRow {
  week_end?: string
  pathogen_target?: string
  site_wval_category?: string
  sites?: string
  updated?: string
}

export interface Week {
  weekEnd: string
  counts: number[]
  sites: number
  level: number | null
}

export interface Series {
  key: string
  label: string
  detail: string
  /** Oldest first, WEEKS long. */
  weeks: Week[]
}

export interface Summary {
  weekEnd: string
  updated: string | null
  sites: number
  series: Series[]
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function normalizeSite(value: string): string | null {
  const match = /^(?:id\s*:?\s*)?(\d+)$/i.exec(value.trim())
  return match ? `ID:${Number(match[1])}` : null
}

/**
 * A county name ready to match against counties_served. The dataset writes
 * bare names ("Los Angeles"), so a typed "County" or "Parish" is dropped, and
 * LIKE wildcards are removed so they match nothing by accident.
 */
export function normalizeCounty(value: string): string {
  return value
    .replace(/[%_]/g, '')
    .replace(/\s+(county|parish|borough|census area|municipality)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function scopeClause(scope: Scope): string {
  switch (scope.kind) {
    case 'nation':
      return ''
    case 'state':
      return `state_territory = ${literal(scope.state)}`
    case 'site':
      return `site = ${literal(scope.site)}`
    case 'county': {
      // counties_served lists every county a sewershed covers, joined with
      // ", ". Matching whole entries keeps "Orange" from matching "Orangeburg".
      const name = normalizeCounty(scope.county).toUpperCase()
      const field = 'upper(counties_served)'
      const entry = [
        `${field} = ${literal(name)}`,
        `${field} like ${literal(`${name},%`)}`,
        `${field} like ${literal(`%, ${name}`)}`,
        `${field} like ${literal(`%, ${name},%`)}`,
      ].join(' OR ')
      return `state_territory = ${literal(scope.state)} AND (${entry})`
    }
  }
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Sites per week, virus and category: about 200 rows for the whole country,
 * where the raw rows for even two weeks run to a megabyte.
 */
export function countsUrl(scope: Scope, now: number): string {
  // A week of slack past the window, as the latest week can be days old.
  const since = isoDate(now - (WEEKS + 1) * 7 * DAY_MS)
  const viruses = VIRUSES.map((virus) => literal(virus.key)).join(', ')
  const where = [
    scopeClause(scope),
    `pathogen_target in (${viruses})`,
    `week_end >= ${literal(since)}`,
  ]
    .filter(Boolean)
    .join(' AND ')
  const params = new URLSearchParams({
    $select:
      'week_end, pathogen_target, site_wval_category, count(*) as sites, max(date_updated) as updated',
    $where: where,
    $group: 'week_end, pathogen_target, site_wval_category',
    $limit: '5000',
  })
  return `${DATASET_URL}?${params}`
}

export function siteUrl(site: string): string {
  const params = new URLSearchParams({
    $select:
      'max(counties_served) as counties, max(state_territory) as state, max(population_served) as population',
    $where: `site = ${literal(site)}`,
  })
  return `${DATASET_URL}?${params}`
}

/**
 * Whether anything in scope has ever reported, with no date limit. Asked only
 * after an empty answer, to tell a misspelt county or unknown site ID from a
 * real place that has gone quiet.
 */
export function everUrl(scope: Scope): string {
  const params = new URLSearchParams({ $select: 'count(*) as rows' })
  const where = scopeClause(scope)
  if (where) params.set('$where', where)
  return `${DATASET_URL}?${params}`
}

export function rowsOf(body: unknown): number | null {
  const first: unknown = Array.isArray(body) ? body[0] : null
  if (!first || typeof first !== 'object' || !('rows' in first)) return null
  const rows = Number((first as { rows: unknown }).rows)
  return Number.isFinite(rows) ? rows : null
}

/**
 * The rank of the median site's category. With an even count it takes the
 * lower of the two middle sites, so it never rounds a level up.
 */
export function medianLevel(counts: number[]): number | null {
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (total === 0) return null
  const middle = Math.floor((total - 1) / 2)
  let seen = 0
  for (let rank = 0; rank < counts.length; rank++) {
    seen += counts[rank]!
    if (seen > middle) return rank
  }
  return null
}

function isoWeek(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : null
}

/** Rows with an unknown virus, category or date are skipped, not guessed at. */
export function summarize(body: unknown): Summary | null {
  if (!Array.isArray(body)) throw new Error('CDC returned no rows')
  const rows = body as CountRow[]

  let latest = ''
  let updated: string | null = null
  const known = new Set<string>(VIRUSES.map((virus) => virus.key))
  for (const row of rows) {
    // A virus CDC adds later must not move the window for the three shown.
    if (!known.has(row.pathogen_target ?? '')) continue
    const week = isoWeek(row.week_end)
    if (week && week > latest) latest = week
    if (typeof row.updated === 'string' && (!updated || row.updated > updated))
      updated = row.updated
  }
  if (!latest) return null

  // Every week ends on the same weekday, so the window is counted back from
  // the latest one in 7-day steps. A week with no reports stays as a gap.
  const latestMs = Date.parse(`${latest}T00:00:00Z`)
  const weekEnds = Array.from({ length: WEEKS }, (_, i) =>
    isoDate(latestMs - (WEEKS - 1 - i) * 7 * DAY_MS),
  )

  const series: Series[] = VIRUSES.map((virus) => {
    const weeks: Week[] = weekEnds.map((weekEnd) => {
      const counts = LEVELS.map(() => 0)
      for (const row of rows) {
        if (row.pathogen_target !== virus.key) continue
        if (isoWeek(row.week_end) !== weekEnd) continue
        const rank = LEVELS.indexOf(row.site_wval_category ?? '')
        const sites = Number(row.sites)
        if (rank < 0 || !Number.isFinite(sites) || sites < 0) continue
        counts[rank]! += sites
      }
      const sites = counts.reduce((sum, count) => sum + count, 0)
      return { weekEnd, counts, sites, level: medianLevel(counts) }
    })
    return { ...virus, weeks }
  })

  const sites = Math.max(...series.map((s) => s.weeks.at(-1)!.sites))
  return { weekEnd: latest, updated, sites, series }
}

export type Change = 'up' | 'down' | 'same' | null

export function changeOf(series: Series): Change {
  const now = series.weeks.at(-1)?.level ?? null
  const before = series.weeks.at(-2)?.level ?? null
  if (now === null || before === null) return null
  return now > before ? 'up' : now < before ? 'down' : 'same'
}

/** Socrata puts the reason for a 400 in "message". */
export function reasonOf(body: unknown): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: unknown }).message
    if (typeof message === 'string' && message) return `: ${message}`
  }
  return ''
}
