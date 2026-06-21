/**
 * Canonical binding strings: lowercase, "+"-joined, modifiers in the fixed
 * order mod → alt → shift, then the key (e.g. "mod+shift+p", "f5", "mod+`").
 * "mod" is Ctrl on Windows/Linux and Cmd on macOS.
 */

const MODIFIER_KEYS = new Set(["control", "meta", "alt", "shift"]);

const KEY_NAMES: Record<string, string> = {
  " ": "space",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
};

export const isMac =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/** True on Windows. Used for native path-separator decisions (macOS + Linux use "/"). */
export const isWindows =
  typeof navigator !== "undefined" && /win/i.test(navigator.platform);

/**
 * The canonical binding a keyboard event represents, or null when the event
 * is a bare modifier or carries no usable key.
 */
export function eventToBinding(
  e: KeyboardEvent | React.KeyboardEvent,
): string | null {
  const raw = e.key.toLowerCase();
  if (MODIFIER_KEYS.has(raw)) return null;
  const key = KEY_NAMES[raw] ?? raw;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

const DISPLAY_NAMES: Record<string, string> = {
  mod: isMac ? "Cmd" : "Ctrl",
  alt: isMac ? "Option" : "Alt",
  shift: "Shift",
  enter: "Enter",
  space: "Space",
  escape: "Esc",
  backspace: "Backspace",
  delete: "Delete",
  tab: "Tab",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

/** "mod+shift+p" → "Ctrl+Shift+P" (Cmd on macOS). */
export function formatBinding(binding: string): string {
  return binding
    .split("+")
    .map((part) => {
      const named = DISPLAY_NAMES[part];
      if (named) return named;
      if (/^f\d{1,2}$/.test(part)) return part.toUpperCase();
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join("+");
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Native text-editing combos a hotkey must never shadow while typing. */
const EDITING_COMBOS = new Set([
  "mod+a",
  "mod+c",
  "mod+v",
  "mod+x",
  "mod+z",
  "mod+y",
  "mod+shift+z",
  "mod+shift+v",
]);

/**
 * Whether a binding is allowed to fire while focus sits in a text field:
 * it must carry a real modifier (plain keys and shift+key are typing) and
 * not collide with the native editing combos.
 */
export function firesInEditable(binding: string): boolean {
  if (!binding.includes("mod+") && !binding.includes("alt+")) return false;
  return !EDITING_COMBOS.has(binding);
}
