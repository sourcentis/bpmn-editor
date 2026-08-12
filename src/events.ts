import type { BpmnEditorEventMap, BpmnEditorEventName } from './types';

type Handler<K extends BpmnEditorEventName> = (payload: BpmnEditorEventMap[K]) => void;

/**
 * Minimal typed pub/sub used by the editor instance's on/off/emit API.
 *
 * Internally stores handlers in a single untyped map: TypeScript cannot narrow a
 * mapped type indexed by a generic key, so the public on/off/emit surface stays
 * fully typed while the storage itself uses a small, contained cast.
 */
export class BpmnEditorEmitter {
    private listeners = new Map<BpmnEditorEventName, Set<(payload: unknown) => void>>();

    on<K extends BpmnEditorEventName>(event: K, handler: Handler<K>): void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(handler as (payload: unknown) => void);
    }

    off<K extends BpmnEditorEventName>(event: K, handler: Handler<K>): void {
        this.listeners.get(event)?.delete(handler as (payload: unknown) => void);
    }

    emit<K extends BpmnEditorEventName>(event: K, payload: BpmnEditorEventMap[K]): void {
        const set = this.listeners.get(event);
        if (!set || set.size === 0) return;
        for (const handler of Array.from(set)) handler(payload);
    }

    /** Removes every registered handler for every event. */
    clear(): void {
        this.listeners.clear();
    }
}
