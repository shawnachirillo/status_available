# Launch roadmap

| Stream | Assignment and acceptance | Ownership and dependency |
| --- | --- | --- |
| A. Core engineering and security | Verify isolated database, runtime grants, hosting boundaries and draft/refund races. Supply repeatable tests and migration checks. | Own authorization helpers, save/restore API changes and isolation setup. Establish shared fixtures first. |
| B. Purchase and onboarding | Connect storefront checkout, implement success/cancel states and verify idempotent provisioning and onboarding. A return URL alone grants no access. | Own storefront, checkout return and onboarding files. Begin UI in parallel with A; coordinate payment and fixture changes. |
| C. Editor and customer assets | Implement hosting management, previews, media limits, export and managed handoff under approved ownership and time rules. | Own editor feature UI and feature APIs. Start interface planning independently; coordinate shared authorization with A and hosting contracts with D. |
| D. Hosting operations | Implement opt-in renewals, reminder schedule and customer-owned domains. Preserve protected data and route deletion policy for approval. | Own hosting operation migrations and services. Agree on renewal and management contracts before C integrates. |
| E. Commercial readiness | Verify accessibility, security, staging, deploy triggers, rollback and customer documentation. | Read-only audits and docs can start in parallel. Staging and release acceptance depend on the applicable feature and provider gates. |

Assign individual files and migration order before parallel implementation. Serialize use of the existing fixed-port database and HTTP fixtures. Use separate worktrees and isolated infrastructure for parallel stateful runs. Release sequencing and a commercial launch estimate depend on confirmed scope, staging access and provider triggers.

## Planning estimate after hosting stabilization

| Stream | Remaining engineering hours |
| --- | ---: |
| A. CI, clean fixtures, least-privilege staging and remaining security verification | 12–22 |
| B. Purchase flow, checkout returns and onboarding | 20–36 |
| C. Editor additions, media, previews, export and handoff | 42–75 |
| D. Renewal, reminders, domains and retention operations | 36–65 |
| E. Staging, accessibility, customer docs and release acceptance | 20–35 |

Planning range: 130–233 engineering hours. This is effort, not elapsed time. External provider access, unresolved product decisions, and release authorization may extend elapsed time. Re-estimate once commercial terms, domain handoff, renewal operations and retention/recovery policy are specified.
