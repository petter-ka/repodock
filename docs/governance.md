# Engineering Governance

## Purpose

RepoDock is intentionally structured so that feature growth does not turn the Wails shell into a monolith. Governance is lightweight for an individual developer but explicit enough to support future team development.

## Definition of Ready

A feature is ready for implementation when:

- the user outcome and scope are stated in `docs/requirements.md` or a feature-specific design;
- module ownership and dependencies are identified;
- security/privacy impact is understood;
- persistence or migration impact is understood;
- acceptance criteria can be tested;
- any irreversible architecture decision has an ADR.

## Definition of Done

A feature is done when:

- the feature behaves on all supported desktop platforms or has a documented platform exception;
- error states and cancellation behavior are handled;
- unit/integration tests cover the high-risk paths;
- accessibility basics are checked in the UI;
- localization strings exist for supported locales;
- docs and ADRs are updated when behavior or architecture changes;
- secrets are not logged or committed;
- the CI quality gates pass.

## Change classification

### Patch
Bug fix without schema, API, or architecture change.

### Minor feature
New behavior contained inside an existing module and compatible with persisted data.

### Major feature
New module, new persistence shape, process semantics, or platform integration. Requires a design note and usually an ADR.

### Breaking change
Anything that invalidates workspace data, public bridge contracts, module contracts, or supported platform behavior. Requires migration/rollback planning.

## Ownership boundaries

- `internal/app`: Wails binding facade only.
- `internal/domain`: stable cross-module types.
- `internal/modules/*`: business capabilities.
- `frontend/src/components/*`: reusable UI and application shell.
- `frontend/src/modules/*`: feature-specific UI/state/API composition.
- `docs/*`: product and engineering decisions.

No module may reach into another module's internal package. Cross-module communication uses the app facade or an explicitly documented service interface.

## Risk review triggers

A design review is mandatory when a change introduces OS-specific behavior, process-tree termination, secret handling, privileged filesystem access, auto-start/background execution, remote networking, or a workspace migration.
