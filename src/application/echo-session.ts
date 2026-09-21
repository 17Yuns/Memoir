import type { AiSettings, SemanticSearchResult } from "../domain/vector-index";
import type { EchoContext } from "../domain/echo";

export type EchoEnvironment = {
  root: string;
  path: string;
  title: string;
  settings: AiSettings;
  indexKey: string;
  enabled: boolean;
};
export type EchoState = { results: SemanticSearchResult[]; loading: boolean; error: boolean; context: EchoContext | null };

export function echoCandidates(results: SemanticSearchResult[], sourcePath: string) {
  const seen = new Set([sourcePath]);
  return results.filter((item) => item.relativePath && Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      if (seen.has(item.relativePath)) return false;
      seen.add(item.relativePath);
      return true;
    }).slice(0, 2);
}

/** Session-local, single-flight scheduler. It owns no editor or persistent history. */
export class EchoSession {
  private state: EchoState = { results: [], loading: false, error: false, context: null };
  private listeners = new Set<() => void>();
  private environment: EchoEnvironment | null = null;
  private environmentKey = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;
  private readyAt = 0;
  private lastStart = -Infinity;
  private flight: { key: string } | null = null;
  private cache: { key: string; results: SemanticSearchResult[] } | null = null;
  private forced = false;

  constructor(private search: (root: string, settings: AiSettings, query: string, limit: number) => Promise<SemanticSearchResult[]>) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(patch: Partial<EchoState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  configure(environment: EchoEnvironment) {
    // A remounted panel must read status before resuming; an unknown status is
    // not itself an index revision and should not discard the session cache.
    if (!environment.indexKey && environment.root === this.environment?.root) {
      environment = { ...environment, indexKey: this.environment.indexKey };
    }
    const key = JSON.stringify([environment.root, environment.path, environment.title, environment.settings, environment.indexKey]);
    const changed = key !== this.environmentKey;
    const toggled = environment.enabled !== this.environment?.enabled;
    this.environment = environment;
    this.environmentKey = key;
    if (!changed && !toggled) return;
    this.revision++;
    this.forced = false;
    if (changed) { this.cache = null; this.publish({ results: [], error: false, loading: false }); }
    if (!environment.enabled) this.publish({ loading: false });
    this.readyAt = Date.now() + 2000;
    this.schedule();
  }
  setContext = (context: EchoContext) => {
    this.revision++;
    this.forced = false;
    this.readyAt = Date.now() + 2000;
    this.publish({ context, error: false, ...(!context.text || context.sourcePath !== this.state.context?.sourcePath ? { results: [] } : {}) });
    this.schedule();
  };
  pause = () => {
    if (this.environment) this.configure({ ...this.environment, enabled: false });
    clearTimeout(this.timer);
  };
  refresh = () => {
    const key = this.queryKey();
    if (!key || this.flight?.key === key) return;
    this.forced = true;
    this.cache = null;
    this.schedule();
  };
  private queryKey() {
    const context = this.state.context;
    if (!this.environment?.enabled || !context?.text || context.composing || context.sourcePath !== this.environment.path) return "";
    return `${this.environmentKey}\0${context.text}`;
  }
  private schedule() {
    clearTimeout(this.timer);
    const key = this.queryKey();
    if (!key || this.flight) return;
    if (!this.forced && this.cache?.key === key) {
      this.publish({ results: this.cache.results, loading: false, error: false });
      return;
    }
    const delay = this.forced ? 0 : Math.max(0, this.readyAt - Date.now(), this.lastStart + 10000 - Date.now());
    this.timer = setTimeout(() => void this.run(), delay);
  }
  private async run() {
    const key = this.queryKey();
    const env = this.environment;
    if (!key || !env || this.flight) return;
    const revision = this.revision;
    const context = this.state.context!;
    this.forced = false;
    this.flight = { key };
    this.lastStart = Date.now();
    this.publish({ loading: true, error: false });
    try {
      const results = echoCandidates(await this.search(env.root, env.settings, `${env.title}\n\n${context.text}`, 20), env.path);
      if (revision === this.revision && key === this.queryKey()) {
        this.cache = { key, results };
        this.publish({ results, error: false });
      }
    } catch {
      if (revision === this.revision && key === this.queryKey()) this.publish({ error: true });
    } finally {
      this.flight = null;
      this.publish({ loading: false });
      // A failed request is retried only by an explicit refresh or new context.
      if (revision !== this.revision || this.forced) this.schedule();
    }
  }
}
