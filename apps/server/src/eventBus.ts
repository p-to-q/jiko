import type { SessionEvent } from "./types.js";

type EventListener = (event: SessionEvent) => void;

export class EventBus {
  private listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: SessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
