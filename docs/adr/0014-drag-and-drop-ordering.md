# ADR-0014: Drag-and-drop ordering of repositories and sequence steps

- Status: Accepted
- Date: 2026-10-07

## Context

Moving a repository to another group was only possible through the repository menu ("Move to group"), which always appended it, and there was no way to change a repository's position inside a group — even though group runs execute members in sidebar order (ADR-0010). Sequence steps could only be reordered one position at a time with ↑/↓ buttons. Users expect to drag items to where they belong.

## Decision

### Backend

- New binding `MoveRepository(id, groupID, index)`. It removes the repository from its current group and inserts it into `groupID` at `index`, counted among the target group's members **excluding the moved repository**. A negative or out-of-range index appends. Moving within the same group reorders it.
- `AssignRepository(id, groupID)` stays as the append-only form and is implemented as `MoveRepository(id, groupID, -1)`.
- Ordering is persisted in `Group.repositoryIds`; `normalize` already keeps that order, so no workspace version bump.

### Frontend

- Native HTML5 drag and drop (works in WKWebView/WebView2); no new dependency. Drags carry a private MIME type (`application/x-repodock-repo`, `application/x-repodock-step`) and drop targets react only while an in-app drag is active, so dropped files or text are ignored.
- Drop position is an insertion slot computed from the pointer against the hovered item's midpoint; pure helpers live in `modules/repository-manager/reorder.ts` and are unit-tested.
- **Sidebar**: a repository row can be dragged within its group or into another group; a line shows the insertion point, and dropping on a group header, an empty group or a collapsed group appends. Dragging is disabled while the filter is active (positions in a filtered list are ambiguous). The repository menu gains Move up / Move down for keyboard users.
- **Sequence editor**: each step has a grip handle (dragging the whole card would break text selection in its fields). Dropping reorders the draft only; saving stays explicit, as with ↑/↓ and Alt+↑/↓.

## Consequences

- One new binding; the mock backend mirrors it.
- Sequential group runs follow the new order immediately after a drop.

## Reconsider when

- Touch input or cross-window dragging is needed (HTML5 DnD is mouse-centric), or groups themselves need to be reorderable.
