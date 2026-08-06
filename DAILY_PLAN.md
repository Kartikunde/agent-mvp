# 7-Day Build Plan

A commit per day, each one a real working checkpoint — this is what judges
look for in commit history, and it keeps you from a last-night scramble.

Suggested workflow every day:
```bash
# ... make your changes ...
git add .
git commit -m "Day N: <what you did>"
git push
```

---

## Day 1 — Core agent loop
- Get `app/agent.py` running end-to-end with just the `calculator` tool.
- Test locally: `uvicorn app.main:app --reload`, confirm a basic goal
  ("what's 15% of 80?") produces a full THINK → TOOL → answer trace.
- **Commit:** `Day 1: working agent loop with calculator tool`

## Day 2 — More tools, real reasoning
- Add your Tavily key, confirm `web_search` returns real results.
- Test a goal that needs 2+ tools in sequence (search → calculate → note).
- **Commit:** `Day 2: add web_search and notes tools`

## Day 3 — Harden the backend
- Add input validation, sensible error messages, check `/docs` (Swagger) works.
- Decide your `MAX_ITERATIONS` cap and confirm the agent stops cleanly at it.
- **Commit:** `Day 3: backend validation and error handling`

## Day 4 — Frontend
- Wire up `static/index.html` (or the React multi-page version) to `/api/run`.
- Confirm the trace renders correctly for a multi-step run, not just a single step.
- **Commit:** `Day 4: agent console UI wired to backend`

## Day 5 — Expand capabilities
- Add `run_code` (sandboxed) and file-upload/read tools if you haven't already.
- Try a goal that genuinely needs code execution (e.g. "compute the first 20 Fibonacci numbers").
- **Commit:** `Day 5: add code execution and file tools`

## Day 6 — Product polish
- Add whatever's missing for demo day: stop/cancel button, run history, tool
  on/off toggles — pick 1–2, not all, if time is short.
- Update the README with a clear "how to run this in 2 minutes" section.
- **Commit:** `Day 6: polish — history, tool toggles, docs`

## Day 7 — Final pass
- Fresh-eyes test: clone the repo into a new folder and follow your own
  README from scratch. Fix anything that trips you up.
- Record a 60–90s demo video/GIF if the hackathon allows it — judges often
  skim these before reading code.
- Push final commit, paste the repo link into your submission form early.
- **Commit:** `Day 7: final testing and submission polish`

---

**Rule of thumb:** a small working commit every day beats one giant commit
on day 7. If a day's feature isn't done, commit what works and keep going —
partial progress in git history is still evidence of real iteration.
