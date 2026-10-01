export class Bridge extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.next = 0;
    this.pending = new Map();
    this.connected = false;
    this.state = null;
    this.closed = false;
  }
  emit(event) {
    this.dispatchEvent(new CustomEvent("event", { detail: event }));
  }
  connect() {
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
    };
    ws.onmessage = (e) => {
      let event;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      if (event.type === "reply") {
        const pending = this.pending.get(event.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(event.id);
          event.ok
            ? pending.resolve(event.data)
            : pending.reject(new Error(event.error));
        } else if (!event.ok) this.emit({ type: "error", error: event.error });
        return;
      }
      if (event.type === "state") this.state = event;
      this.emit(event);
    };
    ws.onclose = () => {
      this.connected = false;
      for (const p of this.pending.values()) {
        clearTimeout(p.timeout);
        p.reject(new Error("Console service disconnected"));
      }
      this.pending.clear();
      this.emit({ type: "offline" });
      if (!this.closed) setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => ws.close();
  }
  command(command, values = {}, quiet = false) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN)
      return quiet
        ? Promise.resolve()
        : Promise.reject(new Error("Console service is reconnecting"));
    if (quiet) {
      this.ws.send(JSON.stringify({ command, ...values }));
      return Promise.resolve();
    }
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Operation timed out"));
      }, 20000);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ ...values, command, requestId: id }));
    });
  }
  sendAudio(buffer) {
    if (this.connected && this.ws.bufferedAmount < 65536) this.ws.send(buffer);
  }
  async get(path) {
    const response = await fetch("/api/" + path);
    if (!response.ok) throw new Error("Could not load " + path);
    return response.json();
  }
}
