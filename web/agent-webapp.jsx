import React, { useState, useRef } from "react";
import {
  Play, Square, History as HistoryIcon, Wrench, Info, Search, Code2,
  StickyNote, FileText, X, Upload, Loader2, ChevronRight, Bot,
  CheckCircle2, Circle, Clock
} from "lucide-react";

const MODEL = "claude-sonnet-4-6";
const MAX_STEPS = 8;

const TOOL_META = {
  web_search: { label: "web_search", icon: Search, desc: "Live web search via Claude's built-in search tool. Returns real titles, URLs, and snippets." },
  calculator: { label: "calculator", icon: Code2, desc: "Evaluates arithmetic expressions safely (+ - * / % ()). No arbitrary code." },
  run_code: { label: "run_code", icon: Code2, desc: "Runs real JavaScript in an isolated Web Worker (no DOM/network access, 4s timeout)." },
  save_note: { label: "notes", icon: StickyNote, desc: "Scratchpad the agent can write to and read back across steps of the same run." },
  read_uploaded_file: { label: "read_file", icon: FileText, desc: "Reads the text file you attach on the Run page (200KB cap)." },
};

function buildToolSchemas(enabled) {
  const schemas = [];
  if (enabled.web_search) schemas.push({ type: "web_search_20250305", name: "web_search", max_uses: 3 });
  if (enabled.calculator) schemas.push({
    name: "calculator",
    description: "Evaluate an arithmetic expression, e.g. '(120 * 3) / 4'.",
    input_schema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
  });
  if (enabled.run_code) schemas.push({
    name: "run_code",
    description: "Execute JavaScript in a sandboxed worker (no DOM/network access) and return console output plus the final expression value. Use for anything calculator cannot do.",
    input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  });
  if (enabled.save_note) {
    schemas.push({
      name: "save_note",
      description: "Save a short intermediate finding to the scratchpad for later steps or the final answer.",
      input_schema: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
    });
    schemas.push({
      name: "read_notes",
      description: "Read back everything saved to the scratchpad so far.",
      input_schema: { type: "object", properties: {} },
    });
  }
  if (enabled.read_uploaded_file) schemas.push({
    name: "read_uploaded_file",
    description: "Read the contents of the file the user attached, if any.",
    input_schema: { type: "object", properties: {} },
  });
  return schemas;
}

function calculatorTool(expression) {
  try {
    if (!/^[\d\s+\-*/().%]+$/.test(expression)) throw new Error("unsupported characters");
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + expression + ")")();
    return String(result);
  } catch (e) {
    return 'calculator error: could not evaluate "' + expression + '" (' + e.message + ")";
  }
}

function runCodeSandboxed(code) {
  return new Promise((resolve) => {
    const workerSrc = [
      "self.onmessage = function(e) {",
      "  var logs = [];",
      "  console.log = function() { logs.push(Array.prototype.slice.call(arguments).map(String).join(' ')); };",
      "  try {",
      "    var result = (0, eval)(e.data);",
      '    self.postMessage({ ok: true, result: result === undefined ? "" : String(result), logs: logs });',
      "  } catch (err) {",
      "    self.postMessage({ ok: false, error: err.message, logs: logs });",
      "  }",
      "};",
    ].join("\n");
    const blob = new Blob([workerSrc], { type: "application/javascript" });
    const worker = new Worker(URL.createObjectURL(blob));
    const timeout = setTimeout(() => {
      worker.terminate();
      resolve("run_code error: execution timed out after 4s (possible infinite loop).");
    }, 4000);
    worker.onmessage = (e) => {
      clearTimeout(timeout);
      worker.terminate();
      const { ok, result, error, logs } = e.data;
      let out = "";
      if (logs && logs.length) out += "console:\n" + logs.join("\n") + "\n";
      out += ok ? "return value: " + result : "error: " + error;
      resolve(out);
    };
    worker.onerror = (e) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve("run_code error: " + e.message);
    };
    worker.postMessage(code);
  });
}

const SYSTEM_PROMPT =
  "You are an autonomous task-completion agent. Break the goal into steps and use the tools available to you as many times as needed. Prefer run_code over calculator for anything beyond basic arithmetic. Only stop calling tools once you have everything needed. Give a clear, complete final answer in plain text with no more tool calls when done.";

const EXAMPLES = [
  { label: "Tip + total on $142.50", goal: "What is 18% tip on a $142.50 bill, and what's the total?" },
  { label: "Search real news + summarize", goal: "Search the web for one interesting recent AI agent news story, save the key fact as a note, then summarize it in two sentences." },
  { label: "Write + run real code", goal: "Write and run code to compute the first 12 Fibonacci numbers, then explain the pattern in one sentence." },
];

function NavButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={
        "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors " +
        (active ? "bg-slate-900 text-stone-50" : "text-slate-500 hover:bg-stone-100 hover:text-slate-800")
      }
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

function Tag({ kind, children }) {
  const map = {
    think: "bg-emerald-50 text-emerald-700",
    tool: "bg-amber-50 text-amber-700",
    search: "bg-amber-50 text-amber-700",
    answer: "bg-slate-900 text-stone-50",
    error: "bg-red-50 text-red-700",
  };
  return (
    <span className={"inline-block font-mono text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded mr-2 " + map[kind]}>
      {children}
    </span>
  );
}

function TraceEntry({ entry }) {
  const dotColor = {
    think: "border-emerald-600",
    tool: "border-amber-600",
    search: "border-amber-600",
    answer: "border-slate-900 bg-slate-900",
    error: "border-red-600",
  }[entry.kind];

  return (
    <div className="relative pb-4">
      <div className={"absolute -left-[27px] top-1.5 w-2.5 h-2.5 rounded-full bg-white border-2 " + dotColor} />
      <div className={"bg-white border rounded-md p-3 " + (entry.kind === "answer" ? "border-slate-900" : "border-stone-200")}>
        {entry.kind === "think" && (
          <>
            <Tag kind="think">think</Tag>
            <span className="font-mono text-[11px] text-slate-400">step {entry.step}</span>
            <div className="text-[13.5px] leading-relaxed mt-1.5 whitespace-pre-wrap">{entry.content}</div>
          </>
        )}
        {entry.kind === "search" && entry.mode === "query" && (
          <>
            <Tag kind="search">web_search</Tag>
            <span className="font-mono text-[11px] text-slate-400">step {entry.step}</span>
            <div className="font-mono text-[10px] uppercase text-slate-400 mt-2">query</div>
            <div className="font-mono text-xs mt-0.5">{entry.query}</div>
          </>
        )}
        {entry.kind === "search" && entry.mode === "results" && (
          <>
            <Tag kind="search">results</Tag>
            <span className="font-mono text-[11px] text-slate-400">{entry.results.length} found</span>
            {entry.results.length === 0 && <div className="text-[13px] mt-1.5">No results.</div>}
            {entry.results.slice(0, 4).map((r, i) => (
              <div key={i} className="text-[12.5px] mt-1.5">
                {r.title || r.url}
                <div className="font-mono text-[11px] text-slate-400 break-all">{r.url}</div>
              </div>
            ))}
          </>
        )}
        {entry.kind === "tool" && (
          <>
            <Tag kind="tool">{entry.tool}</Tag>
            <span className="font-mono text-[11px] text-slate-400">step {entry.step}</span>
            {entry.input && (
              <>
                <div className="font-mono text-[10px] uppercase text-slate-400 mt-2">input</div>
                {entry.tool === "run_code" ? (
                  <pre className="bg-stone-50 border border-stone-200 rounded p-2 font-mono text-[11.5px] mt-0.5 whitespace-pre-wrap break-words">{entry.input.code}</pre>
                ) : (
                  <div className="font-mono text-xs mt-0.5 break-words">{JSON.stringify(entry.input)}</div>
                )}
              </>
            )}
            <div className="font-mono text-[10px] uppercase text-slate-400 mt-2">output</div>
            {entry.tool === "run_code" ? (
              <pre className="bg-stone-50 border border-stone-200 rounded p-2 font-mono text-[11.5px] mt-0.5 whitespace-pre-wrap break-words">{entry.output}</pre>
            ) : (
              <div className="font-mono text-xs mt-0.5 break-words">{entry.output}</div>
            )}
          </>
        )}
        {entry.kind === "answer" && (
          <>
            <Tag kind="answer">final answer</Tag>
            <span className="font-mono text-[11px] text-slate-400">{entry.steps} step(s)</span>
            <div className="text-[13.5px] leading-relaxed mt-1.5 whitespace-pre-wrap">{entry.content}</div>
          </>
        )}
        {entry.kind === "error" && (
          <>
            <Tag kind="error">error</Tag>
            <div className="text-[13.5px] leading-relaxed mt-1.5 whitespace-pre-wrap">{entry.content}</div>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("run");
  const [goal, setGoal] = useState("");
  const [entries, setEntries] = useState([]);
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState([]);
  const [viewingHistoryId, setViewingHistoryId] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [toolsEnabled, setToolsEnabled] = useState({
    web_search: true, calculator: true, run_code: true, save_note: true, read_uploaded_file: true,
  });

  const cancelRef = useRef(false);
  const fileInputRef = useRef(null);

  const viewingRun = viewingHistoryId ? runs.find((r) => r.id === viewingHistoryId) : null;
  const displayEntries = viewingRun ? viewingRun.entries : entries;

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 200000) {
      alert("File too large — 200KB max for this demo.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setUploadedFile({ name: file.name, content: String(reader.result) });
    reader.readAsText(file);
  }

  async function callClaude(messages, toolSchemas) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: toolSchemas,
        messages,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error("API error " + response.status + ": " + errText.slice(0, 200));
    }
    return response.json();
  }

  async function runAgent() {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) return;

    setViewingHistoryId(null);
    setRunning(true);
    cancelRef.current = false;
    setEntries([]);

    const localNotes = [];
    const currentFile = uploadedFile;
    const toolSchemas = buildToolSchemas(toolsEnabled);
    const runEntries = [];

    function push(entry) {
      runEntries.push(entry);
      setEntries((prev) => [...prev, entry]);
    }

    function saveNoteTool(note) {
      localNotes.push(note);
      return "Saved note #" + localNotes.length + ".";
    }
    function readNotesTool() {
      if (localNotes.length === 0) return "No notes saved yet.";
      return localNotes.map((n, i) => i + 1 + ". " + n).join("\n");
    }
    function readFileTool() {
      if (!currentFile) return "No file attached. Ask the user to attach one first.";
      return "File: " + currentFile.name + "\n\n" + currentFile.content.slice(0, 4000);
    }

    const messages = [{ role: "user", content: trimmedGoal }];

    try {
      for (let step = 1; step <= MAX_STEPS; step++) {
        if (cancelRef.current) {
          push({ kind: "error", content: "Stopped by user." });
          break;
        }

        const data = await callClaude(messages, toolSchemas);
        const content = data.content || [];
        let sawClientTool = false;
        const toolResultsForNextTurn = [];

        for (const block of content) {
          if (cancelRef.current) break;

          if (block.type === "text" && block.text && block.text.trim()) {
            push({ kind: "think", step, content: block.text });
          } else if (block.type === "server_tool_use" && block.name === "web_search") {
            push({ kind: "search", mode: "query", step, query: block.input.query || "" });
          } else if (block.type === "web_search_tool_result") {
            const results = Array.isArray(block.content) ? block.content : [];
            push({ kind: "search", mode: "results", results });
          } else if (block.type === "tool_use") {
            sawClientTool = true;
            let output;
            if (block.name === "calculator") output = calculatorTool(block.input.expression);
            else if (block.name === "save_note") output = saveNoteTool(block.input.note);
            else if (block.name === "read_notes") output = readNotesTool();
            else if (block.name === "read_uploaded_file") output = readFileTool();
            else if (block.name === "run_code") output = await runCodeSandboxed(block.input.code);
            else output = "Unknown tool: " + block.name;

            push({ kind: "tool", step, tool: block.name, input: block.input, output: String(output) });
            toolResultsForNextTurn.push({ type: "tool_result", tool_use_id: block.id, content: String(output) });
          }
        }

        if (cancelRef.current) break;

        if (!sawClientTool) {
          const finalText = content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
          push({ kind: "answer", steps: step, content: finalText || "(no answer produced)" });
          setRuns((prev) => [
            { id: Date.now(), goal: trimmedGoal, entries: runEntries, answer: finalText, steps: step, timestamp: new Date() },
            ...prev,
          ].slice(0, 20));
          break;
        }

        messages.push({ role: "assistant", content });
        messages.push({ role: "user", content: toolResultsForNextTurn });

        if (step === MAX_STEPS) {
          push({ kind: "error", content: "Reached the step limit before finishing." });
        }
      }
    } catch (err) {
      push({ kind: "error", content: err.message });
    } finally {
      setRunning(false);
    }
  }

  function stopAgent() {
    cancelRef.current = true;
  }

  return (
    <div className="min-h-screen bg-stone-50 text-slate-800" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between border-b border-stone-200 pb-4 mb-6">
          <div className="flex items-baseline gap-2.5">
            <Bot size={18} className="text-slate-700" />
            <h1 className="font-mono text-[15px] font-semibold tracking-tight m-0">agent console</h1>
            <span className="text-xs text-slate-400">— multi-page, live API calls</span>
          </div>
          <nav className="flex gap-1">
            <NavButton active={page === "run"} onClick={() => setPage("run")} icon={Play} label="Run" />
            <NavButton active={page === "history"} onClick={() => setPage("history")} icon={HistoryIcon} label="History" />
            <NavButton active={page === "tools"} onClick={() => setPage("tools")} icon={Wrench} label="Tools" />
            <NavButton active={page === "about"} onClick={() => setPage("about")} icon={Info} label="About" />
          </nav>
        </div>

        {page === "run" && (
          <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-8">
            <div className="bg-white border border-stone-200 rounded-md p-4 h-fit">
              <label htmlFor="goal-input" className="font-mono text-[11px] uppercase tracking-wide text-slate-400 block mb-2">Goal</label>
              <textarea
                id="goal-input"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. What's 18% tip on $142.50, and the total?"
                autoFocus
                className="w-full min-h-[90px] border border-stone-200 rounded p-2.5 text-base sm:text-sm bg-white text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-text"
              />

              {!running ? (
                <button
                  onClick={runAgent}
                  className="mt-3 w-full py-2.5 rounded bg-slate-900 text-stone-50 font-mono text-xs font-semibold uppercase tracking-wide flex items-center justify-center gap-2 hover:bg-slate-800"
                >
                  <Play size={13} /> Run agent
                </button>
              ) : (
                <button
                  onClick={stopAgent}
                  className="mt-3 w-full py-2.5 rounded bg-red-700 text-stone-50 font-mono text-xs font-semibold uppercase tracking-wide flex items-center justify-center gap-2 hover:bg-red-800"
                >
                  <Square size={13} /> Stop
                </button>
              )}

              <div className="mt-5">
                <p className="font-mono text-[11px] uppercase tracking-wide text-slate-400 mb-2">Examples</p>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    onClick={() => setGoal(ex.goal)}
                    className="block w-full text-left border border-dashed border-stone-200 text-slate-500 px-2.5 py-2 rounded mb-1.5 text-xs hover:border-amber-500 hover:text-slate-800"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>

              <div className="mt-5 pt-4 border-t border-stone-200">
                {!uploadedFile ? (
                  <label className="flex items-center justify-center gap-2 border border-dashed border-stone-200 text-slate-500 px-2.5 py-2 rounded text-xs cursor-pointer hover:border-amber-500 hover:text-slate-800">
                    <Upload size={13} /> attach a text file
                    <input ref={fileInputRef} type="file" accept=".txt,.csv,.json,.md,.log" onChange={handleFile} className="hidden" />
                  </label>
                ) : (
                  <div className="flex items-center justify-between text-xs font-mono text-emerald-700 border border-emerald-100 bg-emerald-50 rounded px-2.5 py-2">
                    <span className="truncate">{uploadedFile.name}</span>
                    <button onClick={() => { setUploadedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="text-red-600 ml-2">
                      <X size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div>
              {viewingRun && (
                <div className="mb-4 flex items-center justify-between bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800">
                  <span>Viewing a past run — read only.</span>
                  <button onClick={() => setViewingHistoryId(null)} className="font-semibold underline">back to live</button>
                </div>
              )}
              <div className="relative pl-6">
                <div className="absolute left-[9px] top-1.5 bottom-1.5 w-px bg-stone-200" />
                {displayEntries.length === 0 && (
                  <div className="font-mono text-sm text-slate-400">awaiting goal_</div>
                )}
                {displayEntries.map((entry, i) => (
                  <TraceEntry key={i} entry={entry} />
                ))}
                {running && (
                  <div className="flex items-center gap-2 text-slate-400 text-xs font-mono">
                    <Loader2 size={13} className="animate-spin" /> thinking…
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {page === "history" && (
          <div>
            {runs.length === 0 ? (
              <div className="text-slate-400 text-sm font-mono">No runs yet this session. Head to Run to start one.</div>
            ) : (
              <div className="space-y-2">
                {runs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => { setViewingHistoryId(r.id); setPage("run"); }}
                    className="w-full text-left bg-white border border-stone-200 rounded-md p-3.5 flex items-center justify-between hover:border-amber-400"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.goal}</div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 font-mono">
                        <span className="flex items-center gap-1"><Clock size={11} /> {r.timestamp.toLocaleTimeString()}</span>
                        <span>{r.steps} step(s)</span>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-slate-300 shrink-0" />
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-400 mt-4">History lives in this browser tab only — it resets on reload, there's no backend storage.</p>
          </div>
        )}

        {page === "tools" && (
          <div>
            <p className="text-sm text-slate-500 mb-4">Toggle which tools the agent can call. Changes apply to your next run.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(TOOL_META).map(([key, meta]) => {
                const Icon = meta.icon;
                const on = toolsEnabled[key];
                return (
                  <div key={key} className="bg-white border border-stone-200 rounded-md p-3.5 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Icon size={16} className="text-amber-700 mt-0.5 shrink-0" />
                      <div>
                        <div className="font-mono text-xs font-semibold">{meta.label}</div>
                        <div className="text-xs text-slate-500 mt-1">{meta.desc}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => setToolsEnabled((prev) => ({ ...prev, [key]: !prev[key] }))}
                      className={"shrink-0 mt-0.5 " + (on ? "text-emerald-600" : "text-stone-300")}
                    >
                      {on ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {page === "about" && (
          <div className="bg-white border border-stone-200 rounded-md p-6 max-w-2xl">
            <h2 className="text-base font-semibold mb-3">How this works</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-3">
              This is a real autonomous agent, not a scripted demo. Every run calls Claude directly
              from your browser: it decides on its own how many steps to take and which tools to call,
              in a loop — think, call a tool, observe the result, think again — until it has enough to
              answer.
            </p>
            <p className="text-sm text-slate-600 leading-relaxed mb-3">
              <span className="font-mono text-xs bg-stone-100 px-1.5 py-0.5 rounded">run_code</span> executes
              in an isolated Web Worker with no DOM or network access and a 4-second timeout.{" "}
              <span className="font-mono text-xs bg-stone-100 px-1.5 py-0.5 rounded">web_search</span> is
              Claude's built-in live search tool. Everything else runs entirely client-side — nothing is
              sent to a server you own, and nothing persists after you close this tab.
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">
              Model: <span className="font-mono text-xs">{MODEL}</span>. Max steps per run: {MAX_STEPS}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
