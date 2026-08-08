# Agent Console - Free Autonomous Agent MVP

An autonomous agent: give it a goal in plain English, and it plans, calls
tools (web search, calculator, a scratchpad), and reports back — with
every step visible in a live execution console.

**Runs entirely on free API access** — powered by Google Gemini's
permanent free developer tier (no credit card, no trial that runs out).
Optional web search uses Tavily's free tier too.

## Why this is genuinely free

Google's Gemini API (via Google AI Studio) has a standing free tier for
Flash-class models, including function calling — which is exactly what
this agent needs. Unlike a one-time trial credit, it doesn't expire or
require billing to be attached. Current limits (rate limits, not cost)
are documented at https://ai.google.dev/gemini-api/docs/rate-limits.

## Project layout

```
agent-mvp/
├── app/
│   ├── main.py      # FastAPI routes: POST /api/run, static file serving
│   ├── agent.py      # the plan → act → observe loop (Gemini function calling)
│   ├── tools.py      # tool schemas + implementations (search, calc, notes)
│   └── config.py     # env-based settings
├── static/
│   └── index.html    # the "agent console" demo UI
├── web/
│   └── agent-webapp.jsx  # multi-page React version (Claude artifact only — see web/README.md)
├── requirements.txt
└── .env.example
```

## Setup (a few minutes, $0)

```bash
cd agent-mvp
python -m venv venv
# Mac/Linux:
source venv/bin/activate
# Windows PowerShell:
.\venv\Scripts\Activate.ps1

pip install -r requirements.txt
cp .env.example .env   # Windows: copy .env.example .env
```

Get your free key:
1. Go to **https://aistudio.google.com/apikey**
2. Sign in with any Google account
3. Click **Create API key** — no billing, no credit card
4. Paste it into `.env` as `GEMINI_API_KEY=...`

Run it:

```bash
uvicorn app.main:app --reload
```

Open **http://localhost:8000** — try one of the built-in example goals.

Interactive API docs (Swagger) are at **http://localhost:8000/docs**.

## About the `web/` folder

`web/agent-webapp.jsx` is a separate, multi-page version of this agent
built as a **Claude artifact** — it calls Claude's API directly from the
browser using access built into Claude.ai's chat interface, so it costs
nothing to run there, but it only works inside a Claude conversation
(paste it into claude.ai). It is not part of this deployable app — the
FastAPI + `static/index.html` combo above is the one you run and host
yourself. See `web/README.md` for details on adapting it into a real
standalone frontend later.

## Extending it

- **New tool** — add a function + schema entry to `app/tools.py`; both
  the Gemini and (if you ever switch back) Anthropic-style formats read
  from the same `TOOL_SCHEMAS` list, so nothing else changes.
- **Swap models** — change `GEMINI_MODEL` in `.env`. `gemini-2.5-flash`
  is the default free-tier workhorse; check Google AI Studio for other
  free-tier-eligible models if you want to compare quality/speed.
- **Streaming trace** — swap the single `POST /api/run` for Server-Sent
  Events so each step appears live instead of all at once at the end.
- **Persistent memory** — replace the in-memory `_NOTES` list in
  `tools.py` with a real store (SQLite is enough for a demo).

## Demo tips

- Lead with the console, not the code — click an example goal and let
  the trace fill in live.
- The `THINK` vs `TOOL` badges are the thing to point at — that ordering
  isn't hardcoded, the model decides it.
- If `web_search` isn't configured (no Tavily key), the tip/interest
  calculator example still proves the full multi-step loop works.

