import type { SVGProps } from "react";

/**
 * GitDesktop brand mark — the app icon (full-bleed app window + git branch).
 * Self-colored, so it renders identically anywhere regardless of text color.
 * Source of truth: design/logos/gitdesktop/final/gitdesktop-icon.svg
 */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" {...props}>
      <rect width="1024" height="1024" rx="212" fill="#4FE0C4" />
      <path
        d="M 0 240 V 212 A 212 212 0 0 1 212 0 H 812 A 212 212 0 0 1 1024 212 V 240 Z"
        fill="#0B2E35"
      />
      <circle cx="156" cy="120" r="40" fill="#4FE0C4" />
      <circle cx="286" cy="120" r="40" fill="#4FE0C4" />
      <circle cx="416" cy="120" r="40" fill="#4FE0C4" />
      <path
        d="M 332 440 V 832"
        stroke="#0B2E35"
        strokeWidth="88"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 332 626 C 332 478 566 438 724 436"
        stroke="#0B2E35"
        strokeWidth="88"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="332" cy="440" r="88" fill="#0B2E35" />
      <circle cx="332" cy="832" r="88" fill="#0B2E35" />
      <circle cx="752" cy="436" r="88" fill="#0B2E35" />
    </svg>
  );
}
