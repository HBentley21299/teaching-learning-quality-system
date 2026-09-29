type Versioned = { rowVersion?: string };
type SaveResult<R> = { ok: boolean; data?: R; message?: string };

/** One writer per evidence item. Edits made during a request become the next snapshot. */
export class QaEvidenceSaveQueue<T extends Versioned, R> {
  private value: T;
  private revision = 0;
  private savedRevision = 0;
  private pending: Promise<boolean> | null = null;
  private submitRequested = false;
  private finalizing = false;
  private disposed = false;
  private submitted = false;
  private send: (value: T, submit: boolean) => Promise<SaveResult<R>>;
  private version: (result: R) => string;
  private changed: (value: T, dirty: boolean, busy: boolean, finalizing: boolean) => void;
  private saved: (result: R) => void;
  private failed: (message: string) => void;

  constructor(options: {
    initial: T;
    send: (value: T, submit: boolean) => Promise<SaveResult<R>>;
    version: (result: R) => string;
    changed: (value: T, dirty: boolean, busy: boolean, finalizing: boolean) => void;
    saved: (result: R) => void;
    failed: (message: string) => void;
  }) {
    this.value = options.initial;
    this.send = options.send;
    this.version = options.version;
    this.changed = options.changed;
    this.saved = options.saved;
    this.failed = options.failed;
  }

  edit(update: (value: T) => T) {
    if (this.disposed || this.finalizing || this.submitted) return;
    this.value = update(this.value);
    this.revision += 1;
    this.notify();
  }

  dispose() { this.disposed = true; }

  save(submit = false): Promise<boolean> {
    if (this.disposed || this.submitted) return Promise.resolve(false);
    if (submit) { this.submitRequested = true; this.finalizing = true; }
    if (this.pending) { this.notify(); return this.pending; }
    // Start on a microtask so pending is assigned before sending or notifying.
    this.pending = Promise.resolve().then(() => this.drain()).finally(() => {
      this.pending = null;
      this.finalizing = false;
      this.notify();
    });
    this.notify();
    return this.pending;
  }

  private notify() {
    if (!this.disposed) this.changed(this.value, this.revision !== this.savedRevision, this.pending !== null, this.finalizing);
  }

  private async drain(): Promise<boolean> {
    while (!this.disposed && (this.revision !== this.savedRevision || this.submitRequested)) {
      const snapshot = this.value;
      const revision = this.revision;
      const submit = this.submitRequested;
      let result: SaveResult<R>;
      try { result = await this.send(snapshot, submit); }
      catch { result = { ok: false, message: "Evidence could not be saved. Your changes are still here; use Save draft to retry." }; }
      if (this.disposed) return false;
      if (!result.ok || !result.data) {
        this.submitRequested = false;
        this.failed(result.message ?? "Evidence could not be saved. Your changes are still here; retry saving.");
        return false;
      }
      this.savedRevision = revision;
      // Carry the new concurrency token forward without replacing edits made while awaiting the server.
      this.value = { ...this.value, rowVersion: this.version(result.data) };
      this.saved(result.data);
      this.notify();
      if (submit) { this.submitted = true; this.submitRequested = false; return true; }
    }
    return !this.disposed;
  }
}
