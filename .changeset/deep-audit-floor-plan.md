---
"@arynbht/factory-engine": minor
"@arynbht/factory-desktop": minor
---

Add an agentic deep-audit swarm and an interactive Floor Plan tab.

"Run audit" now also fans out a swarm of read-only headless Claude Code agents
(subscription auth) that map the repository into a structured model — systems,
subsystems, features, APIs, connectors, datastores and how they connect — persist
it to `.factory/floorplan.json`, and render it as an interactive Cytoscape graph in
a new Floor Plan tab. The deterministic scorecard is unchanged; the swarm runs
alongside it and never blocks it. The model refreshes on audit, on demand, after a
Fix/AI change lands, and on repo switch (staleness-aware). The swarm requires the
Claude CLI; without it the scorecard is unaffected and the tab explains why.
