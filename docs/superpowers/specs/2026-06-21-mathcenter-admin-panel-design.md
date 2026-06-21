# Math-center admin panel (head-teacher self-service) — design

**Date:** 2026-06-21
**Status:** Approved for planning

## Goal

Give a center's **head teachers** (and global admins) a self-service panel to manage
their own center, with three tabs:

1. **Группы** — create / list / delete groups.
2. **Преподаватели** — view teachers; add existing users as teachers; toggle head; remove;
   invite by link.
3. **Ученики** — view students; add existing users as students; move them between groups;
   remove; invite by link.

"Invite by link" reuses the existing invitation-token engine: a token carries a **preset**
that auto-enrolls the registrant into this center, and the token is shared as a
`/register?token=…` link that pre-fills the registration page.

## What already exists (reuse, do not rebuild)

- **Token preset engine** — `backend/internal/tokenpreset/tokenpreset.go`. Typed `Preset`:
  ```go
  type Preset struct {
      Version           int
      GrantsAdmin       bool
      MathCenterStudent *MathCenterStudent // { GroupID int64 }
      MathCenterTeacher *MathCenterTeacher // { CenterID int64; IsHeadTeacher bool }
  }
  ```
  `Validate(ctx, q, p)` runs at token creation (referenced group/center must exist; rejects
  student+teacher of the same center). `Apply(ctx, q, userID, p)` runs inside the registration
  transaction and calls `AddStudentToGroup` / `AddTeacherToCenter` / `SetUserAdmin` atomically.
  Honors per-center student/teacher exclusivity (`ErrConflict` → 409).
- **invitation_tokens** table already has `preset JSONB`. `CreateInvitationToken` already
  accepts `Preset`. `register.go` already parses + applies the preset. **The enrollment side
  is done.**
- **Per-center membership queries** — `ListGroupsForCenter`, `CreateMathCenterGroup`,
  `DeleteMathCenterGroup`, `GetGroup`, `ListTeachersForCenter`, `AddTeacherToCenter`,
  `SetTeacherHead`, `RemoveTeacher`, `ListHeadTeachersForCenter`, `ListStudentsForCenter`,
  `AddStudentToGroup`, `RemoveStudent`, `GetStudentByUserID`, `IsTeacherInCenter`,
  `IsStudentInCenter`, `RevokeInvitationTokenByID`, `GetInvitationTokenByValue`.
- **Transaction pattern** to mirror — `CreateMathCenterAccount` (admin/mathcenter.go): begin tx,
  create row, enroll, commit.
- **Frontend head-teacher status** — `useMathCenterMe()` returns
  `teacher.centers[].is_head_teacher`; no new "am I head teacher" endpoint needed.

## Decisions (confirmed with the user)

- **Audience & placement:** per-center panel for **head teachers** (+ global admins), inside
  the mathcenter teacher UI. Not the global `/admin` area.
- **Invites are tokens + a link form:** extend the existing token mechanism; add a
  `/register?token=…` link that pre-fills the registration page. Not a separate magic-link system.
- **Tokens auto-enroll** via the existing preset engine.
- **Head teachers are full managers:** they may mint head-teacher invites and promote others to
  head. (The last-head-teacher lockout guard still applies.)
- **Include the cosmetic invite-context lookup** on the registration page.

## Architecture

### Authorization

New gate **`requireHeadTeacher(ctx, q, userID, centerID) (bool, error)`** in the mathcenter
handlers: `true` if the user is admin (fast-path, mirrors `requireTeacher`) **or**
`IsHeadTeacherInCenter(userID, centerID)`. Every `manage/*` endpoint calls it first, and every
mutation additionally verifies the **target row belongs to `{centerID}`** (a head teacher of
center A must never touch center B via a guessed `groupId` / `teacherId` / `studentId` /
`tokenId`).

### Routes

Mounted under the existing mathcenter router (`/api/v1/mathcenter`), following the
`/centers/{centerID}/…` convention, in a new file `manage.go` (+ `manage_test.go`):

```
/centers/{centerID}/manage
  Groups
    GET    /groups
    POST   /groups                      { name }
    DELETE /groups/{groupID}
  Teachers
    GET    /teachers
    POST   /teachers                     { user_id, is_head_teacher }
    PATCH  /teachers/{teacherID}/head    { is_head_teacher }
    DELETE /teachers/{teacherID}
  Students
    GET    /students
    POST   /students                     { user_id, group_id }
    PATCH  /students/{studentID}/group   { group_id }     // move within this center
    DELETE /students/{studentID}
  User search (for "assign from users")
    GET    /user-search?q=               -> [{ id, username, first_name, middle_name, last_name }]
  Invites
    GET    /invites                      -> this center's tokens + use counts
    POST   /invites                      { role, group_id?, is_head_teacher?, description, max_uses, expires_in_hours }
    DELETE /invites/{tokenID}            // revoke (expires_at = NOW())
```

Public (no auth), added to the auth router:

```
GET /auth/invite/{token}  -> { description, valid, role, center_name, group_name? }
```

### Data model — migration `000013_token_center_scope`

Add a nullable owning-center column to `invitation_tokens`:

```sql
-- up
ALTER TABLE invitation_tokens
    ADD COLUMN math_center_id BIGINT REFERENCES math_centers(id) ON DELETE CASCADE;
CREATE INDEX idx_invitation_tokens_math_center_id
    ON invitation_tokens (math_center_id) WHERE math_center_id IS NOT NULL;
-- down
DROP INDEX idx_invitation_tokens_math_center_id;
ALTER TABLE invitation_tokens DROP COLUMN math_center_id;
```

- Set to the owning center when a head teacher (or admin) creates a center-scoped invite via
  `POST /manage/invites`. Global admin tokens (`/admin/tokens`) leave it `NULL`.
- Used purely for **ownership/scoping**: the panel lists/revokes only tokens with
  `math_center_id = {centerID}`, and a head teacher may revoke a token only if its
  `math_center_id` is a center they head. Cascade-deletes a center's tokens with the center.
- The `preset` JSONB still drives the actual enrollment — unchanged.

Rationale vs. alternative: filtering by parsing `preset` JSON would need a `group_id → group →
center` join for **student** tokens (their preset carries only `group_id`), on every list and
every revoke-authorization check. An explicit column is simpler, indexable, and gives clean
cascade cleanup.

### New / changed sqlc queries (`backend/queries/…`)

- `IsHeadTeacherInCenter(user_id, math_center_id) -> bool` (EXISTS on `math_center_teachers`
  with `is_head_teacher = true`).
- `SetStudentGroup(id, group_id)` — `UPDATE math_center_students SET group_id = $2 WHERE id = $1`.
- `SearchUsers(q)` — `SELECT id, username, first_name, middle_name, last_name FROM users
  WHERE (username ILIKE … OR first_name ILIKE … OR last_name ILIKE …) ORDER BY username LIMIT 20`.
  Returns minimal fields only.
- `ListInvitationTokensForCenter(math_center_id)` — tokens for the panel (mirrors
  `ListInvitationTokens` but filtered).
- **Modify** `CreateInvitationToken` to accept `math_center_id` (nullable). Update the one
  existing caller (`admin/tokens.go CreateToken`) to pass `nil`. Regenerate with
  `/Users/alarion239/go/bin/sqlc generate`.

### Server-built, constrained presets (`POST /manage/invites`)

The client **never** sends a raw preset. The handler builds it from `role` + `group_id`/center:

- `role == "teacher"` → `Preset{ MathCenterTeacher: { CenterID: centerID, IsHeadTeacher: body.is_head_teacher } }`.
- `role == "student"` → require `group_id` ∈ this center (verify via `GetGroup`) →
  `Preset{ MathCenterStudent: { GroupID: group_id } }`.
- **Forbidden:** `grants_admin`, any `center_id` other than `{centerID}`, any group outside the
  center. The handler ignores client preset input entirely and constructs the preset itself, then
  runs `tokenpreset.Validate` and stores via `CreateInvitationToken` with
  `math_center_id = centerID`, `description`, `max_uses`, `expires_at = now + expires_in_hours`,
  and a freshly generated token string (same generator as `admin/tokens.go`).

### Guards & invariants

- **Last-head-teacher lockout:** `RemoveTeacher` and `SetTeacherHead(false)` reject when the
  target is the only head teacher of the center (count head teachers first; mirror the admin
  self-demote guard). Returns 409 with a clear message.
- **Role exclusivity & one-group-per-student:** already enforced by `AddTeacherToCenter` /
  `AddStudentToGroup` callers and `tokenpreset.Apply`; the add/move handlers surface the
  conflict as 409.
- **Cross-center safety:** every mutation re-derives the target's center and checks it equals
  `{centerID}` (groups via `GetGroup`, teachers/students via their center, tokens via
  `math_center_id`).

## Frontend

### Routing & nav

- New route `/mathcenter/:centerId/manage` → `ManagePage`.
- A **«Управление»** nav entry shown only when
  `useMathCenterMe().teacher.centers.find(c => c.id === centerId)?.is_head_teacher` or
  `user.is_admin`. A small `useManageAccess(centerId)` hook encapsulates this; `ManagePage`
  renders "Нет доступа" otherwise.

### Components (`frontend/web/src/features/mathcenter/manage/`)

- `ManagePage` — tab shell (Группы / Преподаватели / Ученики).
- `GroupsTab` — list + create + delete (reuses `ConfirmButton`).
- `TeachersTab` — roster (head badge, toggle, remove) + **«Пригласить»** section (list active
  teacher invite links with copy-link button + create-invite form) + "add from users"
  (user-search autocomplete → add).
- `StudentsTab` — roster grouped by group, per-student **group selector** (move) + remove +
  **«Пригласить»** section (per-group invite links + create-invite form) + "add from users".
- `InviteList` / `CreateInviteForm` — shared between the two tabs; builds the
  `/register?token=…` link and offers copy-to-clipboard.
- `UserSearchSelect` — debounced search box backed by `GET /manage/user-search`.

### Shared package (`frontend/shared/src`)

- `types/index.ts` — `TokenView` gains `math_center_id?: number | null`; new `ManageTeacher`,
  `ManageStudent`, `ManageGroup`, `CenterInvite`, `UserSearchResult`, `InviteContext` types.
- `queries/` — `useManageGroups/Teachers/Students/Invites` (+ create/update/delete mutations),
  `useUserSearch(centerId, q)`, `useInviteContext(token)` (public lookup).
- `validation/` — schemas for create-group, add-teacher, add-student, move-student,
  create-invite.

### Registration page

- `register-page.tsx` reads `?token=` from the URL; when present, pre-fills and **locks** the
  token field, and calls `useInviteContext(token)` to show
  "Вы вступаете в «<center>» как <role> (группа <group>)". Plain `/register` is unchanged
  (manual token entry).

## Testing

- **Backend (pgxmock):** `manage_test.go` covers — head-teacher gate (admin allowed,
  non-head-teacher 403); cross-center rejection (target row in another center → 403/404);
  group CRUD; add/remove/promote teacher + last-head-teacher guard (409); add/move/remove
  student + one-group invariant; user-search; invite create builds the correct constrained
  preset and stamps `math_center_id`; invite list/revoke scoped to the center; preset never
  taken from client input. Public `GET /auth/invite/{token}` view test. Update `tokens_test.go`
  / `register_test.go` only as needed for the `CreateInvitationToken` signature change.
- **Frontend:** `npm run typecheck`, `lint`, `npm test`. Add tests for the manage tabs'
  happy-path rendering and the register page reading `?token=`.
- **Backend build:** `sqlc generate`, `go build ./...`, `go test ./...`, `gofumpt -l`,
  rebuild the backend container so migration 000013 applies.

## Out of scope (YAGNI)

- Adding the preset UI to the **global** `/admin/tokens` form (admins can still create
  enrollment tokens via API). The head-teacher panel covers the center use case.
- Email delivery of invites — links are copy-paste.
- Bulk import / CSV.
- A distinct "center owner" role beyond `is_head_teacher`.

## Risks / notes

- A head teacher can mint head-teacher invites and promote others to head (by decision). The
  last-head-teacher guard prevents accidental lockout, but a head teacher can still add a
  co-head who then removes them; acceptable for the trust model (head teachers manage their own
  center).
- Exposing a name/username search to head teachers is a minor disclosure; mitigated by
  requiring a query and returning minimal fields, and head teachers already see rosters.
- Deleting a center cascades its scoped tokens (desired).

## Verification (end to end)

1. `sqlc generate`; `go build ./...`; `go test ./...`; rebuild backend (migration 000013).
2. As a head teacher of a seeded center: open «Управление» → create a group; add an existing
   user as a teacher; toggle head; try to remove the only head teacher → blocked (409).
3. Students tab: add an existing user to a group; move them to another group; create a student
   invite for group A (`max_uses` = 30) → copy the `/register?token=…` link.
4. Open the link logged-out → register page shows "вступаете в «…» как ученик группы А", token
   locked → register → new account lands enrolled in group A; appears in the roster.
5. Create a teacher invite (head = true) → register via it → new head teacher appears.
6. Confirm a head teacher of center A gets 403/404 when calling manage endpoints with center B's
   ids. Confirm `/admin/tokens` still creates global (`math_center_id = NULL`) tokens.
7. `npm test` + `typecheck` + `lint` (web) and `go test ./...` (backend) green. Land on `main`
   per the usual branch → PR → merge workflow.
