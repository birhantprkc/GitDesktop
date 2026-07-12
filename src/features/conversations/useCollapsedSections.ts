import { useSaveSettings, useSettings } from "@/lib/settings/queries";

/** The conversation panel a collapse key belongs to. The remote key is
 *  feature-scoped, not provider-scoped, so collapsing the remote section in a
 *  GitHub repo also collapses it in a GitLab repo (intended — the preference is
 *  global). */
export type ConversationFeature = "pulls" | "issues";
type SectionKind = "local" | "remote";

/**
 * Global, persisted collapse state for the two sections ("Local" and the remote
 * provider section) of a conversation list panel. Keyed `"<feature>:<kind>"`
 * (e.g. `"pulls:local"`), stored as a flat string array so a missing key = the
 * section is expanded (the default). Both the shell (which unmounts a collapsed
 * section body) and the caller (which drops a collapsed section's rows from the
 * arrow-key registry) read the same state, so a collapsed section can never hold
 * a selectable-but-invisible row.
 */
export function useCollapsedSections(feature: ConversationFeature) {
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const collapsed = settings.data?.collapsedConversationSections ?? [];

  const key = (kind: SectionKind) => `${feature}:${kind}`;
  const isCollapsed = (kind: SectionKind) => collapsed.includes(key(kind));

  function toggle(kind: SectionKind) {
    if (!settings.data) return;
    const k = key(kind);
    const next = collapsed.includes(k)
      ? collapsed.filter((c) => c !== k)
      : [...collapsed, k];
    saveSettings.mutate({
      ...settings.data,
      collapsedConversationSections: next,
    });
  }

  return {
    localCollapsed: isCollapsed("local"),
    remoteCollapsed: isCollapsed("remote"),
    toggleLocal: () => toggle("local"),
    toggleRemote: () => toggle("remote"),
  };
}
