import type { ReactNode } from "react";

/**
 * Wraps content that must never appear in PostHog session recordings.
 * PostHog's blockSelector targets .ph-no-capture — anything inside is recorded
 * as a blank box. Apply to diff viewers, file content, terminal output, commit
 * message editors, and any other surface that may show code or secrets.
 */
export function Redacted({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ph-no-capture${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
