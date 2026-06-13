import {
  useEffect,
  useEffectEvent,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useSettings } from "@/lib/settings/queries";
import { eventToBinding, firesInEditable, isEditableTarget } from "./binding";
import { ACTIONS, type ActionId } from "./registry";

interface HandlerEntry {
  run: () => void;
  enabled: boolean;
}

/**
 * Live handlers, registered by whichever components are currently mounted.
 * Hidden <Activity> tabs unmount their effects, so per-tab actions are only
 * live on the visible tab. The newest enabled registration wins.
 */
const liveHandlers = new Map<ActionId, HandlerEntry[]>();

// Notified on every register/unregister/enable change so the palette can
// re-derive "what's available right now".
const subscribers = new Set<() => void>();

// Snapshot for useSyncExternalStore: a stable Set reference that's only
// rebuilt when the handler map actually changes. NOTE: reading liveHandlers
// directly during render would be invisible to the React Compiler's
// memoization — the store subscription is the sanctioned reactive path.
let availableSnapshot: Set<ActionId> | null = null;

function getAvailableSnapshot(): Set<ActionId> {
  if (availableSnapshot === null) {
    const out = new Set<ActionId>();
    for (const [id, entries] of liveHandlers) {
      if (entries.some((e) => e.enabled)) out.add(id);
    }
    availableSnapshot = out;
  }
  return availableSnapshot;
}

function notify() {
  availableSnapshot = null;
  for (const fn of subscribers) fn();
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** Runs the newest enabled handler for an action. True when one ran. */
export function dispatchAction(id: ActionId): boolean {
  const entries = liveHandlers.get(id) ?? [];
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].enabled) {
      entries[i].run();
      return true;
    }
  }
  return false;
}

/**
 * Registers `run` as the live handler for an action while the component is
 * mounted. `enabled` mirrors the corresponding button's disabled state so a
 * hotkey can never do what the UI wouldn't allow.
 */
export function useHotkeyAction(id: ActionId, run: () => void, enabled = true) {
  const stableRun = useEffectEvent(run);
  useEffect(() => {
    const entry: HandlerEntry = { run: stableRun, enabled };
    const list = liveHandlers.get(id) ?? [];
    liveHandlers.set(id, [...list, entry]);
    notify();
    return () => {
      const current = liveHandlers.get(id) ?? [];
      liveHandlers.set(
        id,
        current.filter((e) => e !== entry),
      );
      notify();
    };
  }, [id, enabled]);
}

/**
 * Effective binding per action: the user's override when present (null =
 * explicitly unbound), else the registry default.
 */
export function useEffectiveBindings(): Map<ActionId, string | null> {
  const settings = useSettings();
  const overrides = settings.data?.hotkeys;
  return useMemo(() => {
    const map = new Map<ActionId, string | null>();
    for (const action of ACTIONS) {
      const override = overrides?.[action.id];
      map.set(
        action.id,
        override === undefined ? action.defaultBinding : override,
      );
    }
    return map;
  }, [overrides]);
}

/** Actions that currently have an enabled live handler (for the palette). */
export function useAvailableActions(): Set<ActionId> {
  return useSyncExternalStore(subscribe, getAvailableSnapshot);
}

/**
 * The app-wide keydown listener. Mounted once in App. Local handlers and
 * Base UI popups run earlier in the bubble path and mark events consumed,
 * so anything that reaches here with defaultPrevented set is skipped.
 */
export function useHotkeysListener() {
  const bindings = useEffectiveBindings();

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat) return;
    const binding = eventToBinding(e);
    if (!binding) return;
    if (isEditableTarget(e.target) && !firesInEditable(binding)) return;
    for (const [id, bound] of bindings) {
      if (bound === binding) {
        if (dispatchAction(id)) e.preventDefault();
        return;
      }
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
