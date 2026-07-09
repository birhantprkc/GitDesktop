- Repository **Access** settings no longer offer the Triage, Maintain, or Admin
  collaborator roles on a personal (user-owned) repository. GitHub silently keeps
  collaborators at Write there — picking a higher role returned success but never
  applied — so the picker now shows Read and Write only (organization repos keep the
  full set), with a short note explaining why.
