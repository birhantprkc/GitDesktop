import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useBranchStats,
  useDefaultBranch,
  useRepoStats,
  useRepoStatus,
} from "@/lib/git/queries";
import type { LanguageStat } from "@/lib/git/types";
import { formatRelativeTime } from "@/lib/time";

/** GitHub-linguist-ish colors for the makeup bar; unknowns fall back to gray. */
const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Rust: "#dea584",
  Python: "#3572a5",
  Ruby: "#701516",
  Go: "#00add8",
  Java: "#b07219",
  Kotlin: "#a97bff",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Swift: "#f05138",
  PHP: "#4f5d95",
  CSS: "#663399",
  SCSS: "#c6538c",
  Less: "#1d365d",
  HTML: "#e34c26",
  XML: "#0060ac",
  JSON: "#5b8db8",
  YAML: "#cb171e",
  TOML: "#9c4221",
  Markdown: "#083fa1",
  Shell: "#89e051",
  PowerShell: "#2670be",
  Batch: "#c1f12e",
  SQL: "#e38c00",
  GraphQL: "#e10098",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Lua: "#000080",
  R: "#198ce7",
  Dart: "#00b4ab",
  Elixir: "#6e4a7e",
  Erlang: "#b83998",
  Haskell: "#5e5086",
  Scala: "#c22d40",
  Perl: "#0298c3",
  "Protocol Buffers": "#df7c2e",
  Zig: "#ec915c",
  HCL: "#844fba",
  Dockerfile: "#384d54",
  Makefile: "#427819",
  CMake: "#da3434",
};
const OTHER_COLOR = "#8b949e";

function langColor(name: string) {
  return LANG_COLORS[name] ?? OTHER_COLOR;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const fmt = (n: number) => n.toLocaleString();

function DateValue({ date }: { date: string | null }) {
  if (!date) return <span>—</span>;
  return (
    <span title={new Date(date).toLocaleString()}>
      {formatRelativeTime(date)}
    </span>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-xs font-medium tabular-nums">
        {children}
      </dd>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1 text-xs font-semibold">{children}</h3>;
}

/** Top languages plus everything else folded into one "Other" slice. */
function makeupSlices(languages: LanguageStat[], max = 8): LanguageStat[] {
  const named = languages.filter((l) => l.name !== "Other");
  const other = languages.filter((l) => l.name === "Other");
  const head = named.slice(0, max);
  const tail = [...named.slice(max), ...other];
  if (tail.length === 0) return head;
  const folded = tail.reduce(
    (acc, l) => ({
      ...acc,
      files: acc.files + l.files,
      lines: acc.lines + l.lines,
      bytes: acc.bytes + l.bytes,
    }),
    { name: "Other", files: 0, lines: 0, bytes: 0 },
  );
  return [...head, folded];
}

function LanguageMakeup({ languages }: { languages: LanguageStat[] }) {
  const slices = makeupSlices(languages);
  const totalLines = slices.reduce((n, l) => n + l.lines, 0);
  if (totalLines === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No text files to break down.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        {slices.map((l) => (
          <div
            key={l.name}
            title={l.name}
            style={{
              width: `${(l.lines / totalLines) * 100}%`,
              backgroundColor: langColor(l.name),
            }}
          />
        ))}
      </div>
      <ul className="space-y-0.5">
        {slices.map((l) => (
          <li key={l.name} className="flex items-center gap-2 text-xs">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: langColor(l.name) }}
            />
            <span className="font-medium">{l.name}</span>
            <span className="tabular-nums text-muted-foreground">
              {((l.lines / totalLines) * 100).toFixed(1)}%
            </span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {fmt(l.lines)} lines · {fmt(l.files)}{" "}
              {l.files === 1 ? "file" : "files"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RepoStatsDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const stats = useRepoStats(repoPath, open);
  const status = useRepoStatus(repoPath);
  const defaultBranch = useDefaultBranch(repoPath);
  const currentBranch = status.data?.branch?.name ?? null;
  const base = defaultBranch.data ?? null;
  const branchStats = useBranchStats(repoPath, currentBranch, base, open);
  const showBranch =
    currentBranch !== null && base !== null && currentBranch !== base;
  const repoName = repoPath.split(/[\\/]/).at(-1) ?? repoPath;
  const data = stats.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Repository statistics</DialogTitle>
          <DialogDescription>
            {repoName} — tracked files only; sizes are measured on disk.
          </DialogDescription>
        </DialogHeader>
        {stats.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : stats.isError ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Couldn't gather statistics: {String(stats.error)}
          </p>
        ) : data ? (
          <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
            <section>
              <SectionTitle>Overview</SectionTitle>
              <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                <Stat label="Commits">{fmt(data.commitCount)}</Stat>
                <Stat label="Contributors">
                  <span
                    title={data.topContributors
                      .map((c) => `${c.name} — ${fmt(c.commits)} commits`)
                      .join("\n")}
                  >
                    {fmt(data.contributorCount)}
                  </span>
                </Stat>
                <Stat label="Branches">{fmt(data.branchCount)}</Stat>
                <Stat label="Tags">{fmt(data.tagCount)}</Stat>
                <Stat label="Tracked files">{fmt(data.trackedFiles)}</Stat>
                <Stat label="Lines of text">{fmt(data.totalLines)}</Stat>
                <Stat label="Working tree size">
                  {formatBytes(data.trackedBytes)}
                </Stat>
                <Stat label="Git data (.git)">
                  {formatBytes(data.gitDirBytes)}
                </Stat>
                <Stat label="First commit">
                  <DateValue date={data.firstCommitDate} />
                </Stat>
                <Stat label="Last commit">
                  <DateValue date={data.lastCommitDate} />
                </Stat>
              </dl>
            </section>

            <section>
              <SectionTitle>Code makeup</SectionTitle>
              <LanguageMakeup languages={data.languages} />
            </section>

            {data.topContributors.length > 0 && (
              <section>
                <SectionTitle>Top contributors</SectionTitle>
                <ul className="space-y-0.5">
                  {data.topContributors.map((c) => (
                    <li
                      key={c.name}
                      className="flex items-baseline justify-between gap-3 text-xs"
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {fmt(c.commits)}{" "}
                        {c.commits === 1 ? "commit" : "commits"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {showBranch && (
              <section>
                <SectionTitle>
                  <span className="font-mono">{currentBranch}</span>{" "}
                  <span className="font-normal text-muted-foreground">
                    vs {base}
                  </span>
                </SectionTitle>
                {branchStats.isPending ? (
                  <Skeleton className="h-16 w-full" />
                ) : branchStats.data ? (
                  <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                    <Stat label="Commits ahead">
                      {fmt(branchStats.data.commitCount)}
                    </Stat>
                    <Stat label="Contributors">
                      {fmt(branchStats.data.contributorCount)}
                    </Stat>
                    <Stat label="Files changed">
                      {fmt(branchStats.data.filesChanged)}
                    </Stat>
                    <Stat label="Lines changed">
                      <span className="text-green-600 dark:text-green-400">
                        +{fmt(branchStats.data.additions)}
                      </span>{" "}
                      <span className="text-red-600 dark:text-red-400">
                        −{fmt(branchStats.data.deletions)}
                      </span>
                    </Stat>
                    <Stat label="First branch commit">
                      <DateValue date={branchStats.data.firstCommitDate} />
                    </Stat>
                    <Stat label="Latest branch commit">
                      <DateValue date={branchStats.data.lastCommitDate} />
                    </Stat>
                  </dl>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Couldn't compare against {base}.
                  </p>
                )}
              </section>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
