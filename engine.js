// Main-thread bridge to the Python engine running in a worker.
class Engine {
  constructor() {
    this.worker = new Worker("engine-worker.js");
    this.pending = new Map();
    this.seq = 0;
    this.worker.onmessage = (e) => {
      const { id, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      error ? p.reject(new Error(error)) : p.resolve(result);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "engine failed to load"));
      this.pending.clear();
    };
  }
  call(cmd, args) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, cmd, args });
    });
  }
  ready() { return this.call("ping"); }
  newGame(opts) { return this.call("new_game", opts); }
  act(kind, amount) { return this.call("act", { kind, amount }); }
  analyze(record) { return this.call("analyze", record); }
  edition() { return this.call("edition"); }
}
window.Engine = Engine;
