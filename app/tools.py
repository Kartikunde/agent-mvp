"""
Tools available to the agent.

Each tool has two parts:
  1. A JSON-schema entry in TOOL_SCHEMAS (what Claude sees, drives tool_use).
  2. A Python function registered in TOOL_FUNCTIONS (what actually runs).

Add a new tool by writing a function + schema and registering both below —
nothing else in the agent loop needs to change.
"""

import ast
import operator
import requests

from app.config import settings

# In-memory scratchpad the agent can write to / read from across steps.
# Reset per-process; fine for a hackathon demo, swap for real storage later.
_NOTES: list[str] = []


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

def web_search(query: str) -> str:
    """Search the web via Tavily. Falls back to a friendly error if no key is set."""
    if not settings.tavily_api_key:
        return (
            "web_search is not configured: no TAVILY_API_KEY set. "
            "Answer using your own knowledge instead, or ask the user to add a key."
        )
    try:
        resp = requests.post(
            "https://api.tavily.com/search",
            json={
                "api_key": settings.tavily_api_key,
                "query": query,
                "max_results": 5,
                "include_answer": True,
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        return f"web_search failed: {exc}"

    lines = []
    if data.get("answer"):
        lines.append(f"Quick answer: {data['answer']}")
    for r in data.get("results", [])[:5]:
        lines.append(f"- {r.get('title')}: {r.get('content', '')[:280]} ({r.get('url')})")
    return "\n".join(lines) if lines else "No results found."


# Only a safe, restricted subset of operators — no eval() of arbitrary code.
_ALLOWED_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def _safe_eval(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _ALLOWED_OPS:
        return _ALLOWED_OPS[type(node.op)](_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _ALLOWED_OPS:
        return _ALLOWED_OPS[type(node.op)](_safe_eval(node.operand))
    raise ValueError("Unsupported expression")


def calculator(expression: str) -> str:
    """Evaluate a basic arithmetic expression safely (+, -, *, /, %, **)."""
    try:
        tree = ast.parse(expression, mode="eval").body
        return str(_safe_eval(tree))
    except Exception as exc:
        return f"calculator error: could not evaluate '{expression}' ({exc})"


def save_note(note: str) -> str:
    """Persist a short finding to the agent's scratchpad for later steps."""
    _NOTES.append(note)
    return f"Saved note #{len(_NOTES)}."


def read_notes(_: str = "") -> str:
    """Return everything saved so far in the scratchpad."""
    if not _NOTES:
        return "No notes saved yet."
    return "\n".join(f"{i+1}. {n}" for i, n in enumerate(_NOTES))


def reset_notes() -> None:
    """Clear the scratchpad. Call this at the start of each new agent run."""
    _NOTES.clear()


# ---------------------------------------------------------------------------
# Schemas Claude sees (Anthropic tool_use format)
# ---------------------------------------------------------------------------

TOOL_SCHEMAS = [
    {
        "name": "web_search",
        "description": "Search the live web for current information. Use for facts, "
        "news, prices, or anything that may have changed since training.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Search query"}},
            "required": ["query"],
        },
    },
    {
        "name": "calculator",
        "description": "Evaluate an arithmetic expression, e.g. '(120 * 3) / 4'.",
        "input_schema": {
            "type": "object",
            "properties": {"expression": {"type": "string"}},
            "required": ["expression"],
        },
    },
    {
        "name": "save_note",
        "description": "Save a short intermediate finding or fact to the scratchpad "
        "so it can be reused in later steps or the final answer.",
        "input_schema": {
            "type": "object",
            "properties": {"note": {"type": "string"}},
            "required": ["note"],
        },
    },
    {
        "name": "read_notes",
        "description": "Read back everything saved to the scratchpad so far.",
        "input_schema": {"type": "object", "properties": {}},
    },
]

TOOL_FUNCTIONS = {
    "web_search": web_search,
    "calculator": calculator,
    "save_note": save_note,
    "read_notes": read_notes,
}
