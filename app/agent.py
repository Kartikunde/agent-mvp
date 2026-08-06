"""
The agent loop — now powered by Google Gemini's free API instead of the
paid Anthropic API. Same ReAct-style shape as before:

    1. Send the goal + conversation so far to Gemini.
    2. If Gemini responds with functionCall parts, execute each tool locally.
    3. Feed the results back to Gemini as functionResponse parts.
    4. Repeat until Gemini answers with plain text, or MAX_ITERATIONS is hit.

Gemini's Developer API (via Google AI Studio) has a genuine, permanent,
no-credit-card free tier that supports function calling — see
https://ai.google.dev/gemini-api/docs/rate-limits for current limits.

Talking to the REST API directly with `requests` (rather than a client
SDK) keeps this dependency-light and avoids SDK version churn.
"""

import time

import requests

from app.config import settings
from app.tools import TOOL_SCHEMAS, TOOL_FUNCTIONS, reset_notes

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = [2, 5, 10]

SYSTEM_PROMPT = """You are an autonomous task-completion agent.

Given a goal, break it down and work through it step by step using the
tools available to you. Call tools as many times as needed to gather
information, compute results, or track findings. Only stop calling tools
once you have everything needed to fully answer the goal.

When you are done, give a clear, complete final answer in plain text
(no more tool calls). Be concise but thorough — the user cannot see your
intermediate tool calls unless they check the execution trace, so the
final answer must stand on its own.
"""


def _gemini_tools():
    """Convert the shared TOOL_SCHEMAS (Anthropic-style input_schema) into
    Gemini's functionDeclarations format (parameters), so tools.py stays
    the single source of truth for what each tool looks like."""
    declarations = [
        {
            "name": s["name"],
            "description": s["description"],
            "parameters": s.get("input_schema", {"type": "object", "properties": {}}),
        }
        for s in TOOL_SCHEMAS
    ]
    return [{"functionDeclarations": declarations}]


class Agent:
    def __init__(self):
        if not settings.gemini_api_key:
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Copy .env.example to .env and add a free key "
                "from https://aistudio.google.com/apikey — no credit card required."
            )
        self.tools = _gemini_tools()

    def _call_gemini(self, contents: list) -> dict:
        url = GEMINI_URL.format(model=settings.gemini_model)

        for attempt in range(MAX_RETRIES + 1):
            try:
                resp = requests.post(
                    url,
                    params={"key": settings.gemini_api_key},
                    json={
                        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                        "contents": contents,
                        "tools": self.tools,
                    },
                    timeout=60,
                )
            except requests.RequestException as exc:
                raise RuntimeError(f"Could not reach Gemini API: {exc}")

            if resp.status_code == 429 and attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS[attempt])
                continue

            if not resp.ok:
                try:
                    detail = resp.json().get("error", {}).get("message", resp.text)
                except ValueError:
                    detail = resp.text
                if resp.status_code == 429:
                    detail += " (still rate-limited after automatic retries — wait a bit longer and try again.)"
                raise RuntimeError(f"Gemini API error ({resp.status_code}): {detail}")

            return resp.json()

    def run(self, goal: str) -> dict:
        reset_notes()
        trace = []
        contents = [{"role": "user", "parts": [{"text": goal}]}]

        for step in range(1, settings.max_iterations + 1):
            try:
                data = self._call_gemini(contents)
            except RuntimeError as exc:
                trace.append({"step": step, "type": "tool_call", "tool": "gemini_api", "input": {}, "output": str(exc)})
                return {"trace": trace, "answer": f"Stopped due to an API error: {exc}", "steps_used": step}

            candidates = data.get("candidates") or []
            if not candidates:
                reason = data.get("promptFeedback", {}).get("blockReason", "no candidates returned")
                return {"trace": trace, "answer": f"Gemini returned no response ({reason}).", "steps_used": step}

            parts = candidates[0].get("content", {}).get("parts", []) or []

            # Gemini 3.x marks internal reasoning parts with "thought": true —
            # keep them out of the visible trace/answer, but still send the
            # full unmodified `parts` back to the API on the next turn below.
            text_parts = [
                p["text"] for p in parts
                if "text" in p and not p.get("thought") and p["text"].strip()
            ]
            if text_parts:
                trace.append({"step": step, "type": "think", "content": "\n".join(text_parts)})

            function_calls = [p["functionCall"] for p in parts if "functionCall" in p]

            if not function_calls:
                final_answer = "\n".join(text_parts).strip() or "(no answer produced)"
                return {"trace": trace, "answer": final_answer, "steps_used": step}

            # Gemini wants to act. Append its turn, then run each tool call.
            contents.append({"role": "model", "parts": parts})

            response_parts = []
            for call in function_calls:
                name = call.get("name", "")
                args = call.get("args", {}) or {}
                fn = TOOL_FUNCTIONS.get(name)
                if fn is None:
                    output = f"Unknown tool: {name}"
                else:
                    try:
                        output = fn(**args)
                    except Exception as exc:  # tool errors shouldn't crash the run
                        output = f"Tool '{name}' raised an error: {exc}"

                trace.append(
                    {"step": step, "type": "tool_call", "tool": name, "input": args, "output": str(output)}
                )
                function_response = {"name": name, "response": {"result": str(output)}}
                # Gemini 3.x requires the response id to match the call id when present.
                if call.get("id"):
                    function_response["id"] = call["id"]
                response_parts.append({"functionResponse": function_response})

            contents.append({"role": "user", "parts": response_parts})

        return {
            "trace": trace,
            "answer": "Reached the step limit before finishing. Try narrowing the goal, "
            "or raise MAX_ITERATIONS in .env.",
            "steps_used": settings.max_iterations,
        }