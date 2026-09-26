# Apps and Markets

The **Apps** section of the sidebar holds hosted applications: product areas with
their own pages under `/apps/<id>` and their own host routes under `/api/apps/<id>`.
Markets is the first app.

## The app contract

Each app declares one surface (`src/lib/apps/contract.ts`):

- **Routes.** The app lists its pages in its own `src/apps/<id>/routes.ts`. The route
  registry merges them, so the sidebar, router, role gate, SPA route manifest and
  WebMCP navigation all see them.
- **Capability.** The host's `GET /api/apps` catalog reports whether each app can be
  served. The sidebar shows an app only when it can be served. The app's pages
  state the reason when it cannot.
- **WebMCP page.** The app's browser tools register only while one of its pages is
  mounted.
- **Typed client.** All of the app's data passes through one typed client module.
- **Atlas renderers.** An app can contribute renderers to Atlas. Markets contributes
  a candle renderer for results whose rows are complete OHLC bars.

Names shown to people come from the app-name configuration, so a rename is a
configuration change.

## Markets

Markets shows the trend state of listings: bullish or bearish, when each one
flipped, and a scanner across many listings at once. The engine computes all of
it; the browser only chooses what to show.

- **Overview** (`/apps/markets`) has asset-class tabs and headline counts. Every
  percentage states its denominator. It also has the trend scanner and a filter
  panel: trend, time since the flip, timeframe, quote and nearness to the all-time
  high.
- **Symbol search** finds one symbol across every venue that lists it. It is fully
  usable from the keyboard.
- **Chart** (`/apps/markets/chart/<listing>`) draws:
  - candles and the trailing trend line, with bullish solid and bearish dashed;
  - flip labels and the flip level;
  - volume, the 14-period ATR, the 200-bar SMA and macro-event markers;
  - a flip timeline and a data table.

  The chart is one keyboard control: the arrow keys, Page Up and Page Down, Home
  and End move between bars, and each bar's prices are announced. A colour-blind
  safe palette is available.
- **Sharing** turns the analysis on screen into an immutable snapshot, with a link
  that expires after at most 24 hours. The link works for signed-in people in the
  same workspace, and the person who shared it can revoke it. A note on a shared
  analysis is a claim, so it must cite a source.
  - The shared page shows the chart exactly as it was when shared. It says whether
    the stored data still reproduces the analysis exactly.

### How the numbers are made

The engine's market methods compute every number:

- A versioned ATR trailing line is computed over final bars; a flip happens only
  when a bar closes strictly beyond the line.
- The latest-state scanner uses one state per listing and timeframe.
- Indicators are computed over the full history and then thinned on the server to
  the chart's pixel width with M4. M4 keeps each column's first, last, lowest and
  highest values and every change of trend direction.
- A coarser timeframe is rolled up on the UTC calendar.

The chart and the scanner read the same signal window, so they agree on every flip.

Everything in Markets is informational only. Nothing in it is advice, and nothing in
it authorises an order. Text written by an agent is labelled as a claim with its
sources.

### Host routes

| Route | Scope | Purpose |
|---|---|---|
| `GET /api/apps` | read | Which apps the engine can serve, with a reason when not. |
| `GET /api/apps/markets/listings` | read | Search listings by symbol, name or venue. |
| `GET /api/apps/markets/chart` | read | One listing's layered, decimated chart. |
| `GET /api/apps/markets/scanner` | read | The latest-state scan with its counts. |
| `GET /api/apps/markets/macro-events` | read | Documented macro events with sources. |
| `POST /api/apps/markets/shares` | write | Seal a snapshot and issue a share link. |
| `GET /api/apps/markets/shares/<id>` | read | A verified shared snapshot. |
| `POST /api/apps/markets/shares/<id>/revoke` | write | Revoke a share link (issuer only). |

The engine's catalog must hold finance listings and bar series: `Listing` and
`BarSeries` records, including each series' tick size, with bars in the time-series
store. Until it does, the scanner is empty and says so.
