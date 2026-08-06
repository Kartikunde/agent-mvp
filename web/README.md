# Multi-page React UI (artifact version)

`agent-webapp.jsx` is a self-contained React component built for Claude's
artifact preview (calls the Anthropic API directly from the browser, no
key needed there). It's the fastest way to demo the concept live.

To turn it into a real deployable frontend later, drop it into a fresh
Vite + React + Tailwind project as `src/App.jsx`, install
`lucide-react`, and point its `fetch` calls at your own backend
(`/api/run` from this repo) instead of `api.anthropic.com` directly —
that keeps your API key server-side where it belongs for a public deploy.
