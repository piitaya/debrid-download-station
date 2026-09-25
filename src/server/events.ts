import type { ServerEvents } from '../shared/types.js';

type EventName = keyof ServerEvents;
type Listener = <K extends EventName>(event: K, data: ServerEvents[K]) => void;

/** Fan-out of server-sent events, per user. */
export class EventHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(username: string, listener: Listener): () => void {
    let set = this.listeners.get(username);
    if (!set) {
      set = new Set();
      this.listeners.set(username, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(username);
    };
  }

  /** Whether the user currently has the app open somewhere. */
  isWatching(username: string): boolean {
    return this.listeners.has(username);
  }

  emit<K extends EventName>(username: string, event: K, data: ServerEvents[K]): void {
    for (const listener of this.listeners.get(username) ?? []) listener(event, data);
  }
}
