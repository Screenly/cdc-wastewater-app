import { changeOf, LEVELS, type Series } from './cdc'

export const LEVEL_NAMES = LEVELS.map(
  (level) => level.charAt(0) + level.slice(1).toLowerCase(),
)

let locale = 'en'

export function setLocale(value: string): void {
  locale = value
}

function el(className: string, text = '', tag = 'div'): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale).format(value)
}

/** Formatted as UTC, so the screen's timezone cannot shift the day. */
export function formatDate(iso: string, withYear: boolean): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: withYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)))
}

export function countyPhrase(counties: string, state: string): string {
  const names = counties
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  // Alaska has boroughs and census areas, which the bare name covers best.
  if (state === 'Alaska') return names.join(', ')
  const [one, many] =
    state === 'Louisiana' ? ['Parish', 'parishes'] : ['County', 'counties']
  if (names.length === 1) return `${names[0]} ${one}`
  const list = new Intl.ListFormat('en', { type: 'conjunction' }).format(names)
  return `${list} ${many}`
}

function changeText(series: Series): string {
  const before = series.weeks.at(-2)?.level
  switch (changeOf(series)) {
    case 'up':
      return `Up from ${LEVEL_NAMES[before!]!.toLowerCase()} last week`
    case 'down':
      return `Down from ${LEVEL_NAMES[before!]!.toLowerCase()} last week`
    case 'same':
      return 'Same as last week'
    default:
      return series.weeks.at(-1)?.level === null ? '' : 'No report last week'
  }
}

function meter(level: number | null): HTMLElement {
  const box = el('meter-steps')
  box.setAttribute('aria-hidden', 'true')
  LEVELS.forEach((_, rank) => {
    const step = el(level !== null && rank <= level ? 'step on' : 'step')
    step.style.setProperty('--tone', `var(--level-${rank})`)
    box.append(step)
  })
  return box
}

function history(series: Series): HTMLElement {
  const box = el('history')
  const bars = el('bars')
  bars.setAttribute('aria-hidden', 'true')
  for (const week of series.weeks) {
    if (week.level === null) {
      bars.append(el('bar gap'))
      continue
    }
    const bar = el('bar')
    bar.style.height = `${((week.level + 1) / LEVELS.length) * 100}%`
    bar.style.background = `var(--level-${week.level})`
    bars.append(bar)
  }
  const axis = el('axis')
  axis.append(
    el('', formatDate(series.weeks[0]!.weekEnd, false), 'span'),
    el('', `${series.weeks.length} weeks`, 'span'),
    el('', formatDate(series.weeks.at(-1)!.weekEnd, false), 'span'),
  )
  box.append(bars, axis)
  return box
}

function spread(series: Series): HTMLElement | null {
  const week = series.weeks.at(-1)!
  if (week.sites < 2) return null
  const box = el('spread')
  const stack = el('stack')
  stack.setAttribute('aria-hidden', 'true')
  week.counts.forEach((count, rank) => {
    if (!count) return
    const part = el('part')
    part.style.flexGrow = String(count)
    part.style.background = `var(--level-${rank})`
    stack.append(part)
  })
  const high = week.counts.slice(2).reduce((sum, count) => sum + count, 0)
  box.append(
    stack,
    el(
      'note',
      `${formatNumber(high)} of ${formatNumber(week.sites)} sites moderate or higher`,
    ),
  )
  return box
}

export function card(series: Series): HTMLElement {
  const level = series.weeks.at(-1)!.level
  const section = el('card', '', 'section')
  if (level === null) section.classList.add('quiet')

  const head = el('virus')
  head.append(
    el('name', series.label, 'h2'),
    el('detail', series.detail, 'span'),
  )
  const now = el('now')
  now.append(
    el('level', level === null ? 'No report' : LEVEL_NAMES[level]!),
    meter(level),
    el('change', changeText(series)),
  )
  const past = el('past')
  past.append(history(series))
  const split = spread(series)
  if (split) past.append(split)

  section.append(head, now, past)
  return section
}

export function legend(): HTMLElement[] {
  return LEVEL_NAMES.map((name, rank) => {
    const item = el('key', '', 'span')
    const swatch = el('swatch', '', 'span')
    swatch.style.background = `var(--level-${rank})`
    item.append(swatch, document.createTextNode(name))
    return item
  })
}
