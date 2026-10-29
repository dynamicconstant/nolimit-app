// Runs the Python engine, bots and analyzer inside the browser (Pyodide = CPython in WebAssembly).
importScripts("pyodide/pyodide.js");

let py = null, session = null;

async function boot() {
  py = await loadPyodide({ indexURL: "pyodide/" });
  const zip = await (await fetch("py.zip")).arrayBuffer();
  py.unpackArchive(zip, "zip", { extractDir: "/app" });
  py.runPython(`
import sys, json
sys.path.insert(0, "/app")
from analysis.session import GameSession
from analysis.analyzer import analyze
from arena.run import BOTS
_game = None

def new_game(opts):
    global _game
    o = json.loads(opts)
    _game = GameSession(mode=o.get("mode", "heads-up"), opponents=o.get("opponents"), seed=o.get("seed"),
                        stack=o.get("stack") or 2000, reveal=o.get("reveal", True))
    return json.dumps({"meta": _game.meta(), "events": _game.start()})

def act(kind, amount):
    return json.dumps({"events": _game.act(kind, int(amount or 0))})

def analyze_record(rec):
    return json.dumps(analyze(json.loads(rec)))

def bots():
    return json.dumps(sorted(BOTS))

def edition():
    try:
        return open("/app/edition.json").read()
    except OSError:
        return '{"edition": "full"}'

`);
}

const ready = boot();

self.onmessage = async (e) => {
  const { id, cmd, args } = e.data;
  try {
    await ready;
    let result;
    if (cmd === "ping") result = "ok";
    else if (cmd === "new_game") result = JSON.parse(py.globals.get("new_game")(JSON.stringify(args)));
    else if (cmd === "act") result = JSON.parse(py.globals.get("act")(args.kind, args.amount || 0));
    else if (cmd === "analyze") result = JSON.parse(py.globals.get("analyze_record")(JSON.stringify(args)));
    else if (cmd === "bots") result = JSON.parse(py.globals.get("bots")());
    else if (cmd === "edition") result = JSON.parse(py.globals.get("edition")());
    else throw new Error("unknown command " + cmd);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err).split("\n").slice(-2).join(" ").trim() });
  }
};
