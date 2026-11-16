# Changelog

User-facing release notes. Technical detail (refactors, dependency bumps, API
changes) belongs in the GitHub Release for the matching tag.

## Unreleased

The first release.

How much COVID-19, flu and RSV virus is turning up in wastewater, from the
CDC's National Wastewater Surveillance System. Each virus shows its level from
Very low to Very high, whether it rose or fell since last week, and the last
13 weeks.

- Show the whole United States, one state or territory, one county, or a
  single wastewater treatment site.
- Choose to skip the app when the area has no recent reports. A misspelt
  county says "No sites found" instead.
- If CDC's data cannot be reached, the screen keeps showing the last data it
  received rather than going blank.
  You can turn that off, and choose whether a screen with nothing to show
  skips the app or says CDC is unavailable.
- Nothing moves and nothing animates. CDC publishes new data every Friday,
  and the screen checks for it every hour.
