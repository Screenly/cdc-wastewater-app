import { describe, expect, test } from 'bun:test'

import { findState } from './states'
import {
  changeOf,
  countsUrl,
  everUrl,
  rowsOf,
  medianLevel,
  normalizeCounty,
  normalizeSite,
  summarize,
  WEEKS,
  type CountRow,
} from './cdc'

const NOW = Date.parse('2026-11-15T12:00:00Z')

function whereOf(url: string): string {
  return new URL(url).searchParams.get('$where') ?? ''
}

function row(
  week: string,
  virus: string,
  category: string,
  sites: number,
): CountRow {
  return {
    week_end: week,
    pathogen_target: virus,
    site_wval_category: category,
    sites: String(sites),
    updated: '2026-11-13 11:02',
  }
}

describe('medianLevel', () => {
  test('is the category the middle site falls in', () => {
    expect(medianLevel([1, 1, 5, 0, 0])).toBe(2)
    expect(medianLevel([4, 0, 0, 0, 3])).toBe(0)
  })

  test('takes the lower middle site of an even count', () => {
    expect(medianLevel([0, 1, 0, 1, 0])).toBe(1)
  })

  test('is null with no sites', () => {
    expect(medianLevel([0, 0, 0, 0, 0])).toBeNull()
  })
})

describe('normalizeSite', () => {
  test('accepts a bare number or the dataset form', () => {
    expect(normalizeSite('112')).toBe('ID:112')
    expect(normalizeSite('ID:112')).toBe('ID:112')
    expect(normalizeSite(' id 0112 ')).toBe('ID:112')
  })

  test('rejects anything else', () => {
    expect(normalizeSite('Los Angeles')).toBeNull()
    expect(normalizeSite('112; drop')).toBeNull()
  })
})

describe('normalizeCounty', () => {
  test('drops the suffix and LIKE wildcards', () => {
    expect(normalizeCounty('Los Angeles County')).toBe('Los Angeles')
    expect(normalizeCounty('Orleans Parish')).toBe('Orleans')
    expect(normalizeCounty('%Kings_ ')).toBe('Kings')
  })
})

describe('countsUrl', () => {
  test('asks for the whole country with only a date filter', () => {
    expect(whereOf(countsUrl({ kind: 'nation' }, NOW))).toBe(
      "pathogen_target in ('SARS-CoV-2', 'Influenza A virus', 'RSV') AND week_end >= '2026-08-09'",
    )
  })

  test('escapes quotes in a state or county', () => {
    const where = whereOf(
      countsUrl({ kind: 'county', state: 'Hawaii', county: "O'ahu" }, NOW),
    )
    expect(where).toContain("state_territory = 'Hawaii'")
    expect(where).toContain("upper(counties_served) = 'O''AHU'")
    expect(where).toContain("like '%, O''AHU,%'")
  })
})

describe('summarize', () => {
  const rows = [
    row('2026-11-07', 'SARS-CoV-2', 'Low', 3),
    row('2026-11-07', 'SARS-CoV-2', 'Moderate', 4),
    row('2026-11-07', 'SARS-CoV-2', 'Very High', 1),
    row('2026-10-31', 'SARS-CoV-2', 'Very Low', 5),
    row('2026-10-31', 'SARS-CoV-2', 'Low', 2),
    row('2026-11-07', 'RSV', 'Very Low', 6),
    row('2026-11-07', 'Mumps', 'High', 9),
    row('2026-11-07', 'RSV', 'Unknown', 9),
  ]

  test('works out each virus from the counts', () => {
    const summary = summarize(rows)!
    expect(summary.weekEnd).toBe('2026-11-07')
    expect(summary.updated).toBe('2026-11-13 11:02')
    expect(summary.sites).toBe(8)

    const covid = summary.series[0]!
    expect(covid.weeks).toHaveLength(WEEKS)
    expect(covid.weeks.at(-1)).toMatchObject({ sites: 8, level: 2 })
    expect(covid.weeks.at(-2)).toMatchObject({ sites: 7, level: 0 })
    expect(changeOf(covid)).toBe('up')
  })

  test('leaves a virus nobody reported as a gap', () => {
    const flu = summarize(rows)!.series[1]!
    expect(flu.weeks.every((week) => week.level === null)).toBe(true)
    expect(changeOf(flu)).toBeNull()
  })

  test('skips unknown viruses and categories', () => {
    const rsv = summarize(rows)!.series[2]!
    expect(rsv.weeks.at(-1)).toMatchObject({ sites: 6, level: 0 })
  })

  test('ignores a newer week that only an unknown virus reported', () => {
    const summary = summarize([...rows, row('2026-11-14', 'Mumps', 'High', 3)])!
    expect(summary.weekEnd).toBe('2026-11-07')
    expect(summary.series[0]!.weeks.at(-1)).toMatchObject({ level: 2 })
  })

  test('is null when nothing reported', () => {
    expect(summarize([])).toBeNull()
  })

  test('throws on a body that is not rows', () => {
    expect(() => summarize({ message: 'bad query' })).toThrow()
  })
})

describe('everUrl', () => {
  test('has no date limit', () => {
    const where = whereOf(
      everUrl({ kind: 'county', state: 'Texas', county: 'Nowhere' }),
    )
    expect(where).toContain("state_territory = 'Texas'")
    expect(where).not.toContain('week_end')
  })
})

describe('rowsOf', () => {
  test('reads the count, or null for anything else', () => {
    expect(rowsOf([{ rows: '0' }])).toBe(0)
    expect(rowsOf([{ rows: '42' }])).toBe(42)
    expect(rowsOf([])).toBeNull()
    expect(rowsOf({ message: 'bad' })).toBeNull()
  })
})

describe('findState', () => {
  test('takes a name or a postal code, in any case', () => {
    expect(findState('California')).toBe('California')
    expect(findState('  new york ')).toBe('New York')
    expect(findState('ca')).toBe('California')
    expect(findState('VI')).toBe('U.S. Virgin Islands')
    expect(findState('Virgin Islands')).toBe('U.S. Virgin Islands')
    expect(findState('Washington, D.C.')).toBe('District of Columbia')
  })

  test('is null for anything else', () => {
    expect(findState('Californa')).toBeNull()
    expect(findState('Ontario')).toBeNull()
  })
})
