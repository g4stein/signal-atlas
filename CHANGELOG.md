# Changelog

## Unreleased

- Cached scanner evidence and non-hourly chart studies by their candle history. Scanner ranking results match the uncached calculation.
- Added UTC handling for zone-free ISO candle timestamps, CSV quoting and clearer validation, Coinbase timeout compatibility and rate-limit backoff, and chart size guards.
- Moved authored files into `src/` and added a deterministic build, a local server, Node tests, and GitHub Actions checks.
- Added keyboard chart navigation and drawing, a visible-candle data table, modal focus handling, and reduced-motion support.
- Added complete journal backup and restore, reset and clear confirmations, and accurate reporting of browser storage failures.

The signal rules, indicator formulas, fill and exit semantics, trading costs, and promotion gates retain their previous values. Local storage and candle database identifiers are unchanged.
