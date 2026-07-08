- **MCP: fetch a CI job's full log.** GitDesktop's built-in MCP server gains a
  `workflow_job_logs` tool that returns a single CI job's complete log by job id (from a
  run's `jobs[].id`) — the whole job's output, not just its failed steps — so an agent can
  drill from a run's jobs into any one job's logs (GitHub Actions and GitLab CI).
