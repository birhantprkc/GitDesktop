import { useRef } from "react";

/** Keeps a ref pointing at the latest value, updated during render.
 *  The render-time write makes THIS hook bail out of the React Compiler —
 *  that's the point: isolating the naughty write here lets every CALLER
 *  compile (bailouts are per-function-body). Callers read `.current` only
 *  inside effects/handlers, never during render. */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
