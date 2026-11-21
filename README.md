# Signal Atlas

**Paper trading only. Nothing in Signal Atlas is financial advice.** Signal Atlas is a static browser terminal for forex and crypto charts, rule-based setups, simulated trades, and strategy research. The app uses native JavaScript modules and has zero dependencies. Gemini chart review is optional and uses a server-side endpoint.

<!-- Screenshot placeholder for the Market Terminal showing the candlestick chart, technical analysis, and ranked setups. -->

## Run locally

Use Node.js 20 or newer.

```sh
npm run dev
npm test
npm run build
npm run check
```

Open http://127.0.0.1:4173/ after starting the dev server. Set `PORT=4180 npm run dev` to change the port. Edit the authored files in `src/` and run `npm run build` before refreshing. The build copies assets byte-for-byte into the tracked `dist/` directory.

## Data sources

| Source | Markets | Behavior |
|---|---|---|
| Demo replay | All five watchlist markets | Synthetic candles with a fixed seed. Step through 15-minute closes or play the sequence. Reduced-motion users can step manually. |
| Coinbase Exchange | BTC/USD and ETH/USD | In Market data mode the app reads closed 15-minute candles. While the tab is visible, it checks for updates every minute and pauses requests after a rate-limit response. |
| Imported CSV | BTC/USD, ETH/USD, EUR/USD, GBP/USD, USD/JPY | Local candle import. A CSV for a crypto market takes precedence over Coinbase for that market in Market data mode. |

### Candle CSV

Use the header `time,open,high,low,close,volume`. The first five columns are required. Volume can be an empty field or an omitted column. Files need 32–16,000 unique, closed 15-minute candles aligned to the quarter hour. OHLC prices must be positive and finite, the high and low must enclose the open and close, and volume must be nonnegative when supplied.

```csv
time,open,high,low,close,volume
2025-01-01T00:00:00Z,"67,500.00",67800,67410,67700,12.3
2025-01-01 00:15,67700,67850,67620,67830,
2025-01-01T00:30,67830,67900,67720,67760,9.7
```

The example shows three rows. Add at least 29 more before importing. ISO timestamps without a zone are interpreted as UTC. Explicit offset ISO timestamps and Unix seconds or milliseconds work. Locale dates such as `01/02/2025` are rejected. Standard CSV quotes and doubled quotes are supported within one line. Quote values containing thousands separators. An import can append newer candles or repeat identical OHLC candles. Earlier inserts and conflicting OHLC rewrites are rejected.

### Journal backups

Export CSV saves the signals currently shown by the journal filters. Set the filters as needed and export each data source to back up the full journal. Import journal CSV merges by signal ID and preserves any outcome already completed in this browser. Backups include the progress fields required to resume tracking active signals. Exports from versions that omitted those fields can still be read as spreadsheets.

Reset demo replay rewinds the simulation and clears its signals and strategy history. Clear journal removes the signals for all sources. Both actions ask for confirmation. Journal entries and preferences stay in the browser, and candle imports use IndexedDB. Export backups before clearing browser storage.

## Strategy and indicators

Signals use a closed 1H candle and the latest eligible closed 4H context. The 1H close and EMA 20/50 alignment establish direction. The 4H close and EMA 20 slope must agree. The setup candle and RSI must support the direction. The app looks for a close beyond the preceding 20-hour range or a pullback around the EMA 20 followed by continuation. If both qualify, it uses the breakout.

Entry is just beyond the setup candle by 0.04 ATR. The stop is 1.2 ATR from entry, and the target is twice the original entry-to-stop distance (2R). An unfilled signal expires after eight eligible 15-minute candles or invalidates early at the stop. A filled trade without a stop or target closes at the end of its 24th 15-minute candle. Return estimates deduct a fixed round-trip cost configured for each market.

| Indicator | Definition |
|---|---|
| EMA 20 and 50 | Exponential moving averages seeded with a simple average of the first 20 or 50 closes. |
| RSI 14 | Relative Strength Index using Wilder-smoothed gains and losses. A flat window returns 50. |
| ATR 14 | Wilder-smoothed true range, including the previous close. |
| MACD | EMA 12 minus EMA 26, with a nine-period EMA signal line. |
| Bollinger Bands | 20-close simple average plus and minus two population standard deviations. |
| Support and resistance | Low and high of the preceding 20 candles, excluding the current candle. |
| Volume | Candle volume when supplied by the data source. |

The candidate momentum filter requires directional RSI momentum of at least seven points from 50 and EMA separation of at least 0.80 ATR. Promotion requires at least 15 priced outcomes per strategy in the held-out replay and 30 per strategy in the forward journal. In each window the candidate must be positive after costs, improve the mean by at least 0.10R, and have no more realized drawdown than the baseline.

## Gemini chart review

Select **Review with Gemini** on a qualifying paper signal in the Terminal or signal detail dialog. The review uses the last 40 closed 1H candles at the setup close, the 4H trend, and held-out evidence. The matching 1H canvas is included when it is visible and fits the image limit. A historical signal needs its original candle history available to review. Reviews stay in memory for the current page session.

Gemini returns a verdict, confidence score, regime, risk flags, summary, and invalidation note. The score reflects the model's assessment. The deterministic engine continues to issue signals, calculate levels, and track outcomes.

To enable reviews, set the server environment variable `GEMINI_API_KEY` in Vercel. The route uses `gemini-4-hydrogen` with High thinking. If setting `GEMINI_MODEL` explicitly, use that same model ID. The key belongs in the server environment. For local testing, export the same variable in the shell before running `npm run dev`.

Vercel builds with `npm run build`, serves `dist/`, and runs `api/ai-review.js` separately. Deploy the repository root so the serverless route is included. A static-only deployment can serve the Terminal, scanner, and journal. Chart review requires a host running the API route.

## Simulation limits

- Only complete higher-timeframe candles feed the strategy. Before the 65% historical split, the backtest excludes any signal that settles after the split. The remaining 35% is evaluated separately.
- Live Coinbase eligibility starts with the first full 15-minute candle after the signal is logged. Historical replay begins at the setup close. Published simulation and live results can differ because of that timing.
- Candle OHLC has no intrabar path. The simulator marks conflicting touches as ambiguous, treats gaps in the series as unpriced, and handles expiry at the 15-minute boundary. Drawdown is calculated from priced outcomes in their processed close order.
- The first signal freezes the historical promotion sample. A small frozen sample may leave a candidate ineligible. Demo results use synthetic prices and do not estimate profitability.

## Deploy

Build and verify the directly servable bundle.

```sh
npm run check
node scripts/build.mjs --verify
git diff --exit-code -- dist
```

For the existing ChatGPT Site, push the selected commit to the Site's configured source repository and package that exact commit.

```sh
git push sites HEAD:main
git archive --format=tar.gz -o /tmp/signal-atlas-deploy.tar.gz HEAD .openai/hosting.json dist
git rev-parse HEAD
```

Here `sites` is a Git remote configured from the Site's source repository URL. In Sites, save and deploy that commit with the archive to the existing project. The tracked `.openai/hosting.json` points hosting at `dist/`. On any other static host, set the publish directory to `dist/`.
