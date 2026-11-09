# Observability & operations



Logs, metrics, traces, SLOs, alerts, runbooks, and on-call practices.



6 control(s).



### `ops.dashboards-golden-signals` — Dashboards for the golden signals

- **phase**: operate · **severity**: low · **effort**: medium
- **detect**: `manual` · **fix**: —

Latency, traffic, errors, and saturation on one dashboard answer 'is it healthy?' at a glance, which is where triage starts.

References:
  - [Google SRE Book — The Four Golden Signals](https://sre.google/sre-book/monitoring-distributed-systems/#xref_monitoring_golden-signals)

### `ops.oncall-rotation` — On-call rotation or schedule documented

- **phase**: operate · **severity**: medium · **effort**: small
- **detect**: `manual` · **fix**: —

A written rotation means everyone knows who responds and how escalation works before an incident, not during one.

References:
  - [Google SRE Workbook — On-call](https://sre.google/workbook/on-call/)

### `ops.postmortem-template` — Blameless postmortem template and log

- **phase**: operate · **severity**: low · **effort**: small
- **detect**: `file-exists` · **fix**: —

A blameless template makes writing the postmortem the default after an incident, so the organisation learns instead of repeating the failure.

References:
  - [Google SRE Book — Postmortem Culture](https://sre.google/sre-book/postmortem-culture/)

### `ops.runbook-per-alert` — Runbook per alert

- **phase**: operate · **severity**: medium · **effort**: medium
- **detect**: `file-exists`, `reviewed` · **fix**: claude `runbook`

An alert without a runbook just wakes someone up; a linked runbook turns a page into a procedure.

References:
  - [Google SRE Workbook — On-call](https://sre.google/workbook/on-call/)

### `ops.slos-defined` — SLOs defined with error budgets

- **phase**: harden · **severity**: medium · **effort**: medium
- **detect**: `file-exists` · **fix**: —

Explicit SLOs and error budgets turn reliability from a feeling into a number that governs how aggressively the team ships.

References:
  - [Google SRE Workbook — Implementing SLOs](https://sre.google/workbook/implementing-slos/)

### `ops.telemetry-exported` — Logs, metrics, and traces exported to a backend

- **phase**: harden · **severity**: high · **effort**: large
- **detect**: `manual` · **fix**: —

You cannot operate what you cannot see; the three signals flowing to one backend is the baseline for debugging production.

References:
  - [Google SRE Book — Monitoring](https://sre.google/sre-book/monitoring-distributed-systems/)
  - [OpenTelemetry](https://opentelemetry.io/docs/)


