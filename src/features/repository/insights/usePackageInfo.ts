import { useQuery } from "@tanstack/react-query";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export interface PackageInfo {
  description: string | null;
}

/** Ecosystems whose registries expose a JSON description we can fetch. */
const FETCHABLE = new Set(["npm", "cargo", "pypi", "pip"]);

// crates.io rejects requests without a User-Agent; harmless for the others.
const HEADERS = { "User-Agent": "GitDesktop" };

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await tauriFetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

async function fetchPackageInfo(
  ecosystem: string,
  name: string,
): Promise<PackageInfo> {
  switch (ecosystem) {
    case "npm": {
      const j = await fetchJson(`https://registry.npmjs.org/${name}/latest`);
      return { description: (j.description as string) ?? null };
    }
    case "cargo": {
      const j = await fetchJson(`https://crates.io/api/v1/crates/${name}`);
      const crate = j.crate as { description?: string } | undefined;
      return { description: crate?.description ?? null };
    }
    case "pypi":
    case "pip": {
      const j = await fetchJson(`https://pypi.org/pypi/${name}/json`);
      const info = j.info as { summary?: string } | undefined;
      return { description: info?.summary ?? null };
    }
    default:
      return { description: null };
  }
}

/**
 * Lazily fetches a dependency's one-line description from its package registry
 * (npm / crates.io / PyPI). Only runs when `enabled` — wire it to the hovercard's
 * open state so we don't fetch hundreds of packages eagerly.
 */
export function usePackageInfo(
  ecosystem: string,
  name: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["package-info", ecosystem, name] as const,
    queryFn: () => fetchPackageInfo(ecosystem, name),
    enabled: enabled && FETCHABLE.has(ecosystem),
    staleTime: 60 * 60_000, // descriptions are stable
    retry: false,
  });
}

export const canFetchPackageInfo = (ecosystem: string) =>
  FETCHABLE.has(ecosystem);
