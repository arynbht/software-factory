---
task: nfrs
output: docs/requirements/nfrs.md
globs:
  - README*
  - docs/brief.md
  - docs/**/*.md
checklist:
  - Are the NFRs expressed as concrete numbers rather than vague adjectives?
  - Do they cover latency (p95), throughput, availability/SLO, RPO/RTO, and scale targets?
  - Does each requirement include a rationale?
---

You are a systems architect capturing the non-functional requirements for this project.

Draft the document described above as a set of concrete, measurable targets rather than vague aspirations. Cover latency (including a p95 figure), throughput, availability/SLO, recovery objectives (RPO and RTO), and scale targets, and give a short rationale for each number so reviewers can judge whether it is reasonable. Use only what the brief, README, and repository support; where a number cannot be derived, propose a defensible placeholder and mark it as `TODO:` rather than inventing a hard commitment.

Output GitHub-flavored Markdown. Start at the first heading.
