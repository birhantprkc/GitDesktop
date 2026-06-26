import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import type { CommunityInsights } from "@/lib/git/types";
import { fmt, Stat } from "./primitives";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      {ok ? (
        <CheckCircleIcon
          weight="fill"
          className="size-3.5 shrink-0 text-success"
        />
      ) : (
        <XCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className={ok ? undefined : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

export function CommunityCard({ data }: { data: CommunityInsights }) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-8">
        <Stat label="Stars">{fmt(data.stargazersCount)}</Stat>
        <Stat label="Forks">{fmt(data.forksCount)}</Stat>
        <Stat label="Watchers">{fmt(data.watchersCount)}</Stat>
        <Stat label="Open issues">{fmt(data.openIssuesCount)}</Stat>
      </dl>
      <div>
        <p className="mb-1 text-xs">
          Community health:{" "}
          <span className="font-medium tabular-nums">
            {data.healthPercentage}%
          </span>
          {data.license && (
            <span className="text-muted-foreground"> · {data.license}</span>
          )}
        </p>
        <ul className="space-y-0.5">
          <Check ok={data.hasReadme} label="README" />
          <Check ok={data.hasLicense} label="License" />
          <Check ok={data.hasCodeOfConduct} label="Code of conduct" />
          <Check ok={data.hasContributing} label="Contributing guide" />
          <Check ok={data.hasIssueTemplate} label="Issue templates" />
          <Check
            ok={data.hasPullRequestTemplate}
            label="Pull request template"
          />
        </ul>
      </div>
    </div>
  );
}
