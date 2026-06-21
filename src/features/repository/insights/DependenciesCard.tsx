import { useVirtualizer } from "@tanstack/react-virtual";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import type { DependencyPackage, RepoDependencies } from "@/lib/git/types";
import { toastError } from "@/lib/toast";
import { fmt } from "./primitives";
import { canFetchPackageInfo, usePackageInfo } from "./usePackageInfo";

/** The package's page on its ecosystem's registry (or repo, for GitHub Actions). */
function packageUrl(ecosystem: string, name: string): string | null {
  switch (ecosystem) {
    case "npm":
      return `https://www.npmjs.com/package/${name}`;
    case "pypi":
    case "pip":
      return `https://pypi.org/project/${name}/`;
    case "cargo":
      return `https://crates.io/crates/${name}`;
    case "githubactions":
    case "actions":
    case "swift":
      // These names are already "owner/repo".
      return `https://github.com/${name}`;
    case "golang":
    case "go":
      return `https://pkg.go.dev/${name}`;
    case "gem":
    case "rubygems":
      return `https://rubygems.org/gems/${name}`;
    case "composer":
      return `https://packagist.org/packages/${name}`;
    case "nuget":
      return `https://www.nuget.org/packages/${name}`;
    case "pub":
      return `https://pub.dev/packages/${name}`;
    case "maven":
      return `https://central.sonatype.com/artifact/${name.replace(":", "/")}`;
    default:
      return null;
  }
}

/** One dependency row: clickable name (opens its registry/repo) + a hovercard
 *  that lazily fetches the package's description. */
function DependencyRow({ p }: { p: DependencyPackage }) {
  const [open, setOpen] = useState(false);
  const url = packageUrl(p.ecosystem, p.name);
  const info = usePackageInfo(p.ecosystem, p.name, open);
  const fetchable = canFetchPackageInfo(p.ecosystem);

  return (
    <HoverCard onOpenChange={setOpen}>
      <HoverCardTrigger
        render={
          <div className="flex w-full items-baseline gap-2 border-b px-2 py-1 text-xs">
            {url ? (
              <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer truncate text-left font-mono hover:underline focus-visible:underline focus-visible:outline-none"
                onClick={() => openUrl(url).catch(toastError)}
              >
                {p.name}
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate font-mono">
                {p.name}
              </span>
            )}
            {p.direct && (
              <span className="shrink-0 rounded-none bg-accent px-1 text-[10px] text-accent-foreground">
                direct
              </span>
            )}
            <span className="shrink-0 rounded-none bg-muted px-1 text-[10px] text-muted-foreground">
              {p.ecosystem}
            </span>
            {p.version && (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {p.version}
              </span>
            )}
          </div>
        }
      />
      <HoverCardContent className="w-72 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
            {p.name}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {p.direct ? "direct" : "transitive"}
          </span>
        </div>
        {fetchable &&
          (info.isFetching ? (
            <p className="text-[11px] text-muted-foreground italic">Loading…</p>
          ) : info.data?.description ? (
            <p className="text-[11px] text-muted-foreground">
              {info.data.description}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              No description available.
            </p>
          ))}
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">
            {p.ecosystem}
            {p.version ? ` · ${p.version}` : ""}
          </span>
          {url && (
            <button
              type="button"
              className="shrink-0 cursor-pointer hover:text-foreground hover:underline"
              onClick={() => openUrl(url).catch(toastError)}
            >
              Open ↗
            </button>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function DependenciesCard({ data }: { data: RepoDependencies }) {
  const [filter, setFilter] = useState("");
  const [directOnly, setDirectOnly] = useState(false);
  // State-backed so the virtualizer observes the scroll element when it mounts.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  const directCount = useMemo(
    () => data.packages.filter((p) => p.direct).length,
    [data.packages],
  );
  const q = filter.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      data.packages.filter(
        (p) =>
          (!directOnly || p.direct) &&
          (!q ||
            p.name.toLowerCase().includes(q) ||
            p.ecosystem.toLowerCase().includes(q)),
      ),
    [data.packages, directOnly, q],
  );

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => 26,
    overscan: 12,
  });

  if (!data.available) {
    return (
      <p className="text-xs text-muted-foreground">
        No dependency graph for this repository — it may be turned off in
        Settings → Security.
      </p>
    );
  }
  if (data.total === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No dependencies detected by the dependency graph.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {fmt(data.total)}
          </span>{" "}
          total · <span className="tabular-nums">{fmt(directCount)}</span>{" "}
          direct
          {(q || directOnly) && (
            <>
              {" · "}
              <span className="tabular-nums">{fmt(filtered.length)}</span> shown
            </>
          )}
        </p>
        <Button
          type="button"
          size="xs"
          variant={directOnly ? "secondary" : "ghost"}
          aria-pressed={directOnly}
          onClick={() => setDirectOnly((v) => !v)}
        >
          Direct only
        </Button>
      </div>
      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter dependencies"
        aria-label="Filter dependencies"
        className="h-7"
        autoComplete="off"
      />
      <div ref={setScrollEl} className="h-56 overflow-y-auto border">
        {filtered.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            No dependencies match.
          </p>
        ) : (
          <div
            className="relative w-full"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const p = filtered[vi.index];
              return (
                <div
                  key={`${p.ecosystem}:${p.name}`}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <DependencyRow p={p} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
