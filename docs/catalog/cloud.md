# Cloud & infrastructure



Infrastructure as code, environments, IAM, backups, and cost controls.



7 control(s).



### `cloud.backups-restore-tested` — Backups configured and restore tested

- **phase**: harden · **severity**: high · **effort**: large
- **detect**: `manual` · **fix**: —

A backup you have never restored is a hope, not a plan; this is satisfied by evidence of a successful restore drill and ages out so it is re-run.

References:
  - [AWS Well-Architected — Reliability](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html)

### `cloud.cost-budget-alert` — Cost budget alert configured

- **phase**: operate · **severity**: low · **effort**: small
- **detect**: `manual` · **fix**: —

A budget alert is the smoke detector for runaway spend; without one, the first signal is the invoice.

References:
  - [FinOps Foundation — Framework](https://www.finops.org/framework/)

### `cloud.iac-plan-in-ci` — IaC plan runs in CI

- **phase**: harden · **severity**: medium · **effort**: medium
- **detect**: `file-matches` · **fix**: —

Running the plan in CI shows the exact infrastructure diff on every change so surprises surface in review, not in production.

References:
  - [HashiCorp — Automate Terraform in CI](https://developer.hashicorp.com/terraform/tutorials/automation/automate-terraform)

### `cloud.iac-present` — Infrastructure as code present

- **phase**: architecture · **severity**: medium · **effort**: large
- **detect**: `file-exists` · **fix**: —

Infrastructure defined as code is reviewable, reproducible, and recoverable; click-ops environments drift and cannot be rebuilt reliably.

References:
  - [AWS Well-Architected — Operational Excellence](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/welcome.html)

### `cloud.least-privilege-iam` — Least-privilege IAM reviewed

- **phase**: harden · **severity**: high · **effort**: medium
- **detect**: `manual` · **fix**: —

Over-broad roles are the blast radius of every breach; a periodic least-privilege review keeps permissions scoped to what is actually used.

References:
  - [AWS — IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)

### `cloud.policy-as-code` — Policy-as-code scan for IaC

- **phase**: harden · **severity**: medium · **effort**: medium
- **detect**: `file-matches` · **fix**: —

Static policy checks catch insecure IaC (public buckets, open security groups) before apply, where fixing them is cheap.

References:
  - [Checkov](https://www.checkov.io/)

### `cloud.rpo-rto-documented` — RPO and RTO written down

- **phase**: architecture · **severity**: medium · **effort**: small
- **detect**: `file-matches` · **fix**: —

Recovery point and time objectives turn 'how much data can we lose and how long can we be down' into numbers the architecture must actually meet.

References:
  - [AWS — Disaster recovery objectives](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html)


