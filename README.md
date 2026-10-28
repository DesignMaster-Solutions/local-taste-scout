# Local Taste Scout

An agent for small local businesses (the taqueria, the barbershop, the yoga studio) that answers one
question owners actually ask: **who should I partner with, what should my next event be about, and
where in town should my flyers go?**

Built by Design Master Solutions LLC for the Qloo Agentic Hackathon. We build websites and apps for
local businesses, and "find me a partner nearby who shares my customers" is the request we hear most
and answer worst, by gut feeling.

## Problem

A local owner has no data team. Generic market research says who lives nearby, not what those people
like. Qloo's taste graph links places, artists and areas through shared audiences, which is exactly the
signal behind a good cross-promotion: a coffee shop and a record bar whose crowds overlap.

## What the agent does

Input: business name, a one-word concept (`tacos`, `vinyl`, `pilates`), a city, optionally an audience
(`millennials`). Output: a Markdown brief where every section cites the Qloo call that produced it.

Each step decides the next request from the previous result:

1. **`find_tags`** resolves the concept. Several Qloo tags share a name (five "Jazz" tags); the agent
   prefers the place-scoped one (then venue-ish tags such as cuisine or amenity), reports the alternatives, and flags ties instead of guessing. No tag
   means it stops with `needs_input`; it never recommends from an uncertain tag.
2. **`recommend` (target `place`)** with that tag, filtered to the city: taste-adjacent venues. The
   business itself (same name) is dropped, since a partner is adjacent, not identical.
3. **`recommend` (target `artist`)** with the tag and the city as a signal: culture hooks for themed
   nights, playlists and content.
4. **`where_popular`** on the strongest partner (by Qloo id, since names like "Thai Food Near Me" exist
   worldwide) within the city: the areas where that shared audience
   concentrates, for flyers and local ads.

The brief ends with **what this does not establish** and the full agent trace (why each call was made,
status, result count, correlation id).

## Qloo surfaces used

- `qloo exec` from the official `@qloo/qloo-harness` (validated workflows, normalized results,
  correlation ids) for the scripted agent.
- `qloo mcp` (`qloo.mcp.json`) so the same tools can be driven from an MCP client such as Claude
  Desktop: ask "find partners for my taqueria in Austin" and the model calls the same four workflows.

## Live demo

Demo video (2:32): **https://youtu.be/3UAzmSCGW0A** (also in `docs/demo.mp4`).

**https://web-production-95a5c.up.railway.app**: type a business, what it sells and a city for a live run
(rate limited per visitor), or open one of the three recorded cases (instant, no Qloo call). The page runs the
same agent as the CLI (`src/server.mjs`, `public/index.html`); `npm start` runs it locally.

## Setup (clean machine)

```sh
# Node 22.19+
npm install --global @qloo/qloo-harness
export QLOO_BASE_URL=https://hackathon.api.qloo.com
export QLOO_TRUSTED_BASE_URL=https://hackathon.api.qloo.com
qloo setup --qloo          # paste your own event key; it is never stored in this repo
git clone https://github.com/DesignMaster-Solutions/local-taste-scout && cd local-taste-scout
npm test                   # unit tests, no key needed
node src/cli.mjs --business "Rosa's Taqueria" --concept tacos --city "Austin, TX"
```

Three real cases are recorded in `fixtures/` and replay with no key:

```sh
npm run demo                                                                                   # Rosa's Taqueria, Austin
node src/cli.mjs --business "Side A Records" --concept "record store" --city "Portland, OR" --replay
node src/cli.mjs --business "Flow Yoga Studio" --concept yoga --city "Denver, CO" --audience millennials --replay
```

`--record` saves each Qloo response to `fixtures/`; `--replay` (and `npm run demo`) re-runs the brief
from those files with no credential, so judges can reproduce the exact demo output. `--json` prints the
raw agent result.

## Responsible data handling

- Inputs are checked before any call: anything that looks like an email or phone number is rejected,
  so no personal data reaches Qloo.
- The key lives only in the harness configuration or the shell; fixtures contain Qloo responses, never
  the credential.
- Harness errors (auth, rate limit) surface as errors. There is no silent fallback.

## Known limitations

- Qloo results describe what groups tend to like, not what any one customer will do.
- A recommended partner is taste-adjacent, not confirmed as open to a deal or still operating.
- The competitor filter is a name heuristic; a chain with a different name can still appear.
- `where_popular` returns coordinates (geohash cells), not neighborhood names; the brief links each to a map.
- A borough or neighborhood as the city ("Brooklyn, NY") was resolved to the wider metro in our tests, so
  use the city name.
- `where_popular` is asked about the top partner, so the area signal is only as good as that match.

## License

MIT, Design Master Solutions LLC.
