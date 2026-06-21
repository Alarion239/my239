# Math-center admin panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give head teachers (and admins) a per-center panel — Группы / Преподаватели / Ученики tabs — to manage their own center, including center-scoped invite links backed by the existing token-preset engine.

**Architecture:** New head-teacher-gated route group `/api/v1/mathcenter/centers/{centerID}/manage/*` mirroring the existing admin handlers but verifying every target row belongs to `{centerID}`. Invite creation builds a constrained `tokenpreset.Preset` server-side and stamps a new `invitation_tokens.math_center_id` column for ownership/scoping. Frontend adds a tabbed `ManagePage`, a `?token=` pre-fill on the register page, and a «Управление» nav entry.

**Tech Stack:** Go (chi, pgx, sqlc, pgxmock), React 19 + Vite + TS, TanStack Query, Tailwind, Zod, react-hook-form.

---

## File structure

**Backend**
- Create `backend/migrations/000013_token_center_scope.{up,down}.sql` — add `math_center_id` to `invitation_tokens`.
- Modify `backend/queries/invitation_tokens.sql` — `CreateInvitationToken` gains `math_center_id`; add `ListInvitationTokensForCenter`.
- Modify `backend/queries/math_center.sql` — add `IsHeadTeacherInCenter`, `SetStudentGroup`, `SearchUsers`.
- Regenerate `backend/internal/store/*` via sqlc.
- Modify `backend/internal/handlers/admin/tokens.go` — pass `MathCenterID: nil` to `CreateInvitationToken`; add `MathCenterID` to `TokenView`.
- Create `backend/internal/handlers/mathcenter/manage.go` — `requireHeadTeacher` + all manage handlers + `ManageRouter`.
- Create `backend/internal/handlers/mathcenter/manage_test.go` — pgxmock coverage.
- Modify `backend/internal/handlers/mathcenter/router.go` — mount `manage` sub-router.
- Create `backend/internal/handlers/auth/invite.go` — public `GET /auth/invite/{token}` lookup.
- Modify `backend/internal/handlers/auth/router.go` — register the lookup route.
- Create `backend/internal/handlers/auth/invite_test.go`.
- Fix `backend/internal/handlers/admin/tokens_test.go` for the `CreateInvitationToken` signature change (if it asserts columns).

**Frontend (shared)**
- Modify `frontend/shared/src/types/index.ts` — add manage types; add `math_center_id` to `InvitationToken`.
- Create `frontend/shared/src/queries/manage.ts` — manage hooks.
- Modify `frontend/shared/src/queries/keys.ts` — manage query keys.
- Modify `frontend/shared/src/queries/index.ts` (barrel) — re-export `manage.ts`.
- Create `frontend/shared/src/validation/manage.ts` — Zod schemas.
- Modify `frontend/shared/src/validation/auth.ts` — token optional in `registerSchema` is already required; no change (token comes via URL too, still required).

**Frontend (web)**
- Create `frontend/web/src/features/mathcenter/manage/manage-page.tsx` — tab shell.
- Create `frontend/web/src/features/mathcenter/manage/groups-tab.tsx`.
- Create `frontend/web/src/features/mathcenter/manage/teachers-tab.tsx`.
- Create `frontend/web/src/features/mathcenter/manage/students-tab.tsx`.
- Create `frontend/web/src/features/mathcenter/manage/invite-section.tsx` — shared invite list + create form + copy-link.
- Create `frontend/web/src/features/mathcenter/manage/user-search-select.tsx` — debounced search.
- Modify `frontend/web/src/features/auth/register-page.tsx` — read `?token=`, pre-fill + lock, show context.
- Modify `frontend/web/src/shell/use-nav-modules.ts` — add «Управление» page for head teachers/admins.
- Modify `frontend/web/src/app/router.tsx` — add `/mathcenter/:centerId/manage` route.

---

## Phase 0 — Migration + sqlc

### Task 1: Migration 000013 — token center scope

**Files:**
- Create: `backend/migrations/000013_token_center_scope.up.sql`
- Create: `backend/migrations/000013_token_center_scope.down.sql`

- [ ] **Step 1: Write `up`**

```sql
-- Scope an invitation token to a single math center so head-teacher panels can
-- list/revoke only their own invites and tokens cascade-delete with the center.
-- NULL = a global (admin-minted) token, unchanged. Enrollment itself is still
-- driven by the `preset` JSONB column; this is purely ownership/scoping.
ALTER TABLE invitation_tokens
    ADD COLUMN math_center_id BIGINT REFERENCES math_centers (id) ON DELETE CASCADE;

CREATE INDEX idx_invitation_tokens_math_center_id
    ON invitation_tokens (math_center_id)
    WHERE math_center_id IS NOT NULL;
```

- [ ] **Step 2: Write `down`**

```sql
DROP INDEX IF EXISTS idx_invitation_tokens_math_center_id;
ALTER TABLE invitation_tokens
    DROP COLUMN IF EXISTS math_center_id;
```

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/000013_token_center_scope.up.sql backend/migrations/000013_token_center_scope.down.sql
git commit -m "feat(db): scope invitation tokens to a math center (000013)"
```

### Task 2: sqlc queries

**Files:**
- Modify: `backend/queries/invitation_tokens.sql`
- Modify: `backend/queries/math_center.sql`
- Modify: `backend/internal/handlers/admin/tokens.go`

- [ ] **Step 1:** In `invitation_tokens.sql`, change `CreateInvitationToken` to include `math_center_id` and add a per-center list:

```sql
-- name: CreateInvitationToken :one
INSERT INTO invitation_tokens (token, description, max_uses, expires_at, preset, math_center_id)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: ListInvitationTokensForCenter :many
SELECT *
FROM invitation_tokens
WHERE math_center_id = $1
ORDER BY created_at DESC;

-- name: GetInvitationTokenByID :one
SELECT *
FROM invitation_tokens
WHERE id = $1;
```

(`GetInvitationTokenByID` is used by `manageRevokeInvite` in Task 7 to verify the token belongs to this center before revoking.)

- [ ] **Step 2:** In `math_center.sql`, append:

```sql
-- name: IsHeadTeacherInCenter :one
SELECT EXISTS (
    SELECT 1
    FROM math_center_teachers
    WHERE user_id = $1
      AND math_center_id = $2
      AND is_head_teacher = TRUE
) AS is_head_teacher;

-- name: CountHeadTeachersForCenter :one
SELECT COUNT(*)
FROM math_center_teachers
WHERE math_center_id = $1
  AND is_head_teacher = TRUE;

-- name: GetTeacher :one
SELECT *
FROM math_center_teachers
WHERE id = $1;

-- name: GetStudent :one
SELECT *
FROM math_center_students
WHERE id = $1;

-- name: SetStudentGroup :execrows
UPDATE math_center_students
SET group_id = $2
WHERE id = $1;

-- name: SearchUsers :many
SELECT id, username, first_name, middle_name, last_name
FROM users
WHERE username ILIKE '%' || @q::text || '%'
   OR first_name ILIKE '%' || @q::text || '%'
   OR last_name ILIKE '%' || @q::text || '%'
ORDER BY username ASC
LIMIT 20;
```

- [ ] **Step 3:** Regenerate:

Run: `/Users/alarion239/go/bin/sqlc generate` (from `backend/`)
Expected: no errors; `store/` regenerated. `CreateInvitationTokenParams` now has `MathCenterID *int64`.

- [ ] **Step 4:** Fix the one existing caller in `admin/tokens.go`. Add `MathCenterID *int64` to `TokenView` and set it; pass `MathCenterID: nil` in `CreateInvitationToken`:

In `TokenView` add field `MathCenterID *int64 \`json:"math_center_id,omitempty"\``. In `ListTokens` and `CreateToken` set `MathCenterID: t.MathCenterID` / `tok.MathCenterID`. In the `CreateInvitationTokenParams` literal add `MathCenterID: nil`.

- [ ] **Step 5:** Build:

Run: `cd backend && go build ./...`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add backend/queries backend/internal/store backend/internal/handlers/admin/tokens.go
git commit -m "feat(db): queries for head-teacher panel + center-scoped tokens"
```

---

## Phase 1 — Backend manage handlers

### Task 3: `requireHeadTeacher` + groups handlers (TDD)

**Files:**
- Create: `backend/internal/handlers/mathcenter/manage.go`
- Create: `backend/internal/handlers/mathcenter/manage_test.go`
- Modify: `backend/internal/handlers/mathcenter/router.go`

**Reference patterns:** `admin/mathcenter.go` (handler bodies, `isUniqueViolation`/`isFKViolation`), `series.go:888 requireTeacher` (gate + `callerIsAdmin`), existing `coffins_test.go` for the pgxmock router test harness (`newRouter`, `authedRequest`, `expectTeacherCheck`).

- [ ] **Step 1: Write the gate + groups handlers** in `manage.go`.

```go
package mathcenter

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/internal/tokenpreset"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// requireHeadTeacher gates the per-center management panel. Like requireTeacher
// it admits admins (effective is_admin) as a superset; otherwise the caller
// must be a HEAD teacher of {centerID}. On false it has already written the
// response.
func requireHeadTeacher(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, userID, centerID int64) bool {
	if callerIsAdmin(r) {
		return true
	}
	isHead, err := q.IsHeadTeacherInCenter(ctx, store.IsHeadTeacherInCenterParams{
		UserID: userID, MathCenterID: centerID,
	})
	if err != nil {
		logger.LogErrorContext(ctx, "manage: head-teacher check", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return false
	}
	if !isHead {
		httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a head teacher of this center")
		return false
	}
	return true
}

// manageGate resolves the {centerID} path param, the caller, and runs the
// head-teacher check. Returns (centerID, userID, ok). On !ok the response is
// already written.
func manageGate(w http.ResponseWriter, r *http.Request, q *store.Queries) (int64, int64, bool) {
	centerID, err := strconv.ParseInt(chi.URLParam(r, "centerID"), 10, 64)
	if err != nil {
		httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid center id")
		return 0, 0, false
	}
	userID, err := ctxcache.UserID(r.Context())
	if err != nil {
		httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeUnauthenticated, "unauthenticated")
		return 0, 0, false
	}
	if !requireHeadTeacher(r.Context(), w, r, q, userID, centerID) {
		return 0, 0, false
	}
	return centerID, userID, true
}

func manageListGroups(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		groups, err := q.ListGroupsForCenter(r.Context(), centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: list groups", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list groups")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, groups)
	}
}

type manageCreateGroupRequest struct {
	Name string `json:"name"`
}

func manageCreateGroup(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		var req manageCreateGroupRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		name := strings.TrimSpace(req.Name)
		if name == "" || len(name) > 50 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "name must be 1–50 chars")
			return
		}
		group, err := q.CreateMathCenterGroup(r.Context(), store.CreateMathCenterGroupParams{
			MathCenterID: centerID, Name: name,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "group with that name already exists")
				return
			}
			logger.LogErrorContext(r.Context(), "manage: create group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create group")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, group)
	}
}

func manageDeleteGroup(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		groupID, err := strconv.ParseInt(chi.URLParam(r, "groupID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid group id")
			return
		}
		// Cross-center guard: the group must belong to {centerID}.
		group, err := q.GetGroup(r.Context(), groupID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "group not found")
				return
			}
			logger.LogErrorContext(r.Context(), "manage: get group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if group.MathCenterID != centerID {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "group not found")
			return
		}
		if _, err := q.DeleteMathCenterGroup(r.Context(), groupID); err != nil {
			logger.LogErrorContext(r.Context(), "manage: delete group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to delete group")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// isUniqueViolation / isFKViolation mirror the helpers in admin/mathcenter.go.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func isFKViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}
```

(Add `"context"` to imports.)

- [ ] **Step 2: Add `ManageRouter`** at the bottom of `manage.go` (filled out across tasks; start with groups):

```go
// ManageRouter is the head-teacher self-service panel, mounted under
// /centers/{centerID}/manage. Every handler re-checks head-teacher access and
// that the target row belongs to {centerID}.
func ManageRouter(database *db.DB) chi.Router {
	r := chi.NewRouter()
	r.Get("/groups", manageListGroups(database))
	r.Post("/groups", manageCreateGroup(database))
	r.Delete("/groups/{groupID}", manageDeleteGroup(database))
	return r
}
```

- [ ] **Step 3: Mount it** in `router.go` after the coffins routes:

```go
	r.Mount("/centers/{centerID}/manage", ManageRouter(database))
```

- [ ] **Step 4: Write the test** in `manage_test.go` covering: non-head-teacher → 403; admin → 200 list; create group happy path; delete group in another center → 404. Model the harness on `coffins_test.go`. The head-teacher check mocks `IsHeadTeacherInCenter`:

```go
func expectHeadCheck(mock pgxmock.PgxPoolIface, userID, centerID int64, isHead bool) {
	mock.ExpectQuery(`is_head_teacher`).
		WithArgs(userID, centerID).
		WillReturnRows(mock.NewRows([]string{"is_head_teacher"}).AddRow(isHead))
}
```

- [ ] **Step 5: Run tests**

Run: `cd backend && go test ./internal/handlers/mathcenter/ -run Manage -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handlers/mathcenter/manage.go backend/internal/handlers/mathcenter/manage_test.go backend/internal/handlers/mathcenter/router.go
git commit -m "feat(mathcenter): head-teacher manage panel — groups + gate"
```

### Task 4: Teachers handlers (add/list/set-head/remove) with last-head guard

**Files:** Modify `manage.go`, `manage_test.go`.

- [ ] **Step 1:** Add handlers. `manageListTeachers` mirrors `manageListGroups` using `ListTeachersForCenter`. `manageAddTeacher` mirrors `admin.AddTeacher` but reads centerID from `manageGate` (transaction: `IsStudentInCenter` guard → `AddTeacherToCenter`). `manageSetTeacherHead` and `manageRemoveTeacher` must enforce the cross-center guard via `GetTeacher` (check `MathCenterID == centerID`) AND the **last-head-teacher guard**:

```go
// guardLastHead returns false (and writes 409) if turning teacher {teacherID}
// non-head (or removing it) would leave the center with zero head teachers.
func guardLastHead(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, centerID int64, t store.MathCenterTeacher) bool {
	if !t.IsHeadTeacher {
		return true // not a head teacher → removing/demoting can't drop the count
	}
	n, err := q.CountHeadTeachersForCenter(ctx, centerID)
	if err != nil {
		logger.LogErrorContext(ctx, "manage: count heads", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return false
	}
	if n <= 1 {
		httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "cannot remove the last head teacher")
		return false
	}
	return true
}
```

`manageSetTeacherHead`: load `GetTeacher`, verify center, and when `req.IsHeadTeacher == false` call `guardLastHead`. `manageRemoveTeacher`: load `GetTeacher`, verify center, call `guardLastHead`, then `RemoveTeacher`.

Add routes to `ManageRouter`:

```go
	r.Get("/teachers", manageListTeachers(database))
	r.Post("/teachers", manageAddTeacher(database))
	r.Patch("/teachers/{teacherID}/head", manageSetTeacherHead(database))
	r.Delete("/teachers/{teacherID}", manageRemoveTeacher(database))
```

- [ ] **Step 2:** Tests: add teacher happy path; demote/remove last head → 409; remove teacher of another center → 404; non-head → 403.

- [ ] **Step 3: Run + commit**

Run: `cd backend && go test ./internal/handlers/mathcenter/ -run Manage`
```bash
git add -A && git commit -m "feat(mathcenter): manage teachers + last-head-teacher guard"
```

### Task 5: Students handlers (add/list/set-group/remove)

**Files:** Modify `manage.go`, `manage_test.go`.

- [ ] **Step 1:** `manageListStudents` → `ListStudentsForCenter`. `manageAddStudent` mirrors `admin.AddStudent` but **also** verifies the target group belongs to `{centerID}` (it already calls `GetGroup`; add `group.MathCenterID != centerID → 400/404`). `manageSetStudentGroup` (PATCH `/students/{studentID}/group`, body `{group_id}`): load `GetStudent`, resolve its current group via `GetGroup` to confirm it is in `{centerID}`, resolve the target group via `GetGroup` and confirm it is **also** in `{centerID}`, then `SetStudentGroup`. `manageRemoveStudent`: load `GetStudent`, resolve group, confirm center, `RemoveStudent`.

Routes:

```go
	r.Get("/students", manageListStudents(database))
	r.Post("/students", manageAddStudent(database))
	r.Patch("/students/{studentID}/group", manageSetStudentGroup(database))
	r.Delete("/students/{studentID}", manageRemoveStudent(database))
```

- [ ] **Step 2:** Tests: add student happy path; add to a group in another center → 404; move within center happy path; move to another center's group → 404; remove.

- [ ] **Step 3: Run + commit**

```bash
git add -A && git commit -m "feat(mathcenter): manage students + group moves"
```

### Task 6: User search

**Files:** Modify `manage.go`, `manage_test.go`.

- [ ] **Step 1:** `manageUserSearch` (GET `/user-search?q=`): gate, read `q := strings.TrimSpace(r.URL.Query().Get("q"))`; if `len(q) < 2` return `[]` (empty `200`); else `SearchUsers(q)` → return rows (id, username, names). Route `r.Get("/user-search", manageUserSearch(database))`.

- [ ] **Step 2:** Test: short query → `[]`; match → rows.

- [ ] **Step 3: Commit** `feat(mathcenter): manage user search`.

### Task 7: Invites (list/create/revoke) with server-built constrained preset

**Files:** Modify `manage.go`, `manage_test.go`.

- [ ] **Step 1:** Define the view + handlers.

```go
type manageInviteView struct {
	ID          int64     `json:"id"`
	Token       string    `json:"token"`
	Description string    `json:"description"`
	MaxUses     int32     `json:"max_uses"`
	Uses        int64     `json:"uses"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
	Role        string    `json:"role"`               // "teacher" | "student"
	GroupID     *int64    `json:"group_id,omitempty"` // for student invites
	IsHead      bool      `json:"is_head_teacher"`
}

type manageCreateInviteRequest struct {
	Role           string `json:"role"` // "teacher" | "student"
	GroupID        int64  `json:"group_id"`
	IsHeadTeacher  bool   `json:"is_head_teacher"`
	Description    string `json:"description"`
	MaxUses        int32  `json:"max_uses"`
	ExpiresInHours int    `json:"expires_in_hours"`
}
```

`manageListInvites`: gate, `ListInvitationTokensForCenter(centerID)`, count uses per row with `CountUsesOfInvitationToken`, parse each `preset` via `tokenpreset.Parse` to fill `Role`/`GroupID`/`IsHead`. (Token VALUES are returned in full so the head teacher can copy the link.)

`manageCreateInvite`: gate; validate `MaxUses > 0`, `ExpiresInHours > 0`, `len(Description) <= 255`; **build the preset server-side** — never from client JSON:

```go
var preset tokenpreset.Preset
switch req.Role {
case "teacher":
	preset.MathCenterTeacher = &tokenpreset.MathCenterTeacher{
		CenterID: centerID, IsHeadTeacher: req.IsHeadTeacher,
	}
case "student":
	// The group must belong to THIS center.
	group, err := q.GetGroup(r.Context(), req.GroupID)
	if err != nil || group.MathCenterID != centerID {
		httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "group must belong to this center")
		return
	}
	preset.MathCenterStudent = &tokenpreset.MathCenterStudent{GroupID: req.GroupID}
default:
	httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "role must be teacher or student")
	return
}
if err := tokenpreset.Validate(r.Context(), q, preset); err != nil { /* 400 on ErrInvalidPreset, else 500 */ }
presetJSON, _ := tokenpreset.Marshal(preset)
raw, _ := randomHexToken() // 32 bytes hex; see note
tok, err := q.CreateInvitationToken(r.Context(), store.CreateInvitationTokenParams{
	Token: raw, Description: req.Description, MaxUses: req.MaxUses,
	ExpiresAt: time.Now().Add(time.Duration(req.ExpiresInHours) * time.Hour),
	Preset: presetJSON, MathCenterID: &centerID,
})
```

Note: add a local `randomHexToken()` helper in `manage.go` (copy the `crypto/rand`+`hex` body from `admin/tokens.go randomHex`), or export `admin.randomHex` — prefer a small local helper to avoid an import cycle.

`manageRevokeInvite` (DELETE `/invites/{tokenID}`): gate; `GetInvitationToken` by id is not available, so fetch via `ListInvitationTokensForCenter` is wasteful — instead add a tiny guard query OR verify ownership by `RevokeInvitationTokenByID` only after confirming center. Simplest: add query `GetInvitationTokenByID :one` and check `MathCenterID == &centerID`; then `RevokeInvitationTokenByID`. (Add that query to `invitation_tokens.sql` in Task 2 if not already; if added later, regenerate.)

Routes:

```go
	r.Get("/invites", manageListInvites(database))
	r.Post("/invites", manageCreateInvite(database))
	r.Delete("/invites/{tokenID}", manageRevokeInvite(database))
```

- [ ] **Step 2:** Tests: create teacher invite → preset has `mathcenter_teacher{center_id=centerID}`, `math_center_id` stamped; create student invite for a foreign group → 400; create with bogus role → 400; revoke a token of another center → 404; list returns role/group parsed.

- [ ] **Step 3: Commit** `feat(mathcenter): center-scoped invite tokens (constrained preset)`.

### Task 8: Public invite lookup

**Files:** Create `auth/invite.go`, `auth/invite_test.go`; modify `auth/router.go`.

- [ ] **Step 1:** `InviteLookup(database)` — `GET /invite/{token}`: fetch `GetInvitationTokenByValue`; on `ErrNoRows` → 404 `{valid:false}`. Compute validity (`now < expires_at` && `uses < max_uses`). Parse preset; resolve role + display names:
  - teacher → role `"teacher"`, `GetMathCenter` for the year → `center_name` like "Матцентр 2027".
  - student → role `"student"`, `GetGroup` then `GetMathCenter` → `center_name` + `group_name`.

```go
type inviteContextView struct {
	Valid       bool   `json:"valid"`
	Description string `json:"description"`
	Role        string `json:"role,omitempty"`        // "teacher" | "student" | "" (plain)
	CenterName  string `json:"center_name,omitempty"`
	GroupName   string `json:"group_name,omitempty"`
}
```

Center display name: reuse the same scheme as the nav — "Матцентр " + graduation_year. (No secrets are returned; the token value itself is the bearer secret.)

- [ ] **Step 2:** Route in `auth/router.go` (public, light rate limit):

```go
	r.With(limiter.Middleware("auth.invite", 30, 60)).
		Get("/invite/{token}", InviteLookup(database))
```

- [ ] **Step 3:** Test: unknown token → 404 `valid:false`; teacher token → role+center; student token → role+center+group.

- [ ] **Step 4: Commit** `feat(auth): public invite-context lookup`.

### Task 9: Backend full check

- [ ] `cd backend && /Users/alarion239/go/bin/sqlc generate && go build ./... && go test ./... && ~/go/bin/gofumpt -l internal/ | tee /dev/stderr | (! read)` → all green, gofumpt clean.
- [ ] Rebuild container so migration 000013 applies: `docker compose up -d --build backend`; confirm healthy ("server listening").
- [ ] Commit any gofumpt fixes.

---

## Phase 2 — Frontend shared

### Task 10: Types + query keys

**Files:** Modify `frontend/shared/src/types/index.ts`, `keys.ts`, `queries/index.ts`.

- [ ] **Step 1:** Add to `types/index.ts` (reuse existing `MathCenterGroup`, `MathCenterTeacher`, `MathCenterStudent` where shapes match the list endpoints; add new ones):

```ts
export interface ManageTeacher {
  id: number
  user_id: number
  math_center_id: number
  is_head_teacher: boolean
  first_name: string
  middle_name?: string | null
  last_name: string
}

export interface ManageStudent {
  id: number
  user_id: number
  group_id: number
  group_name: string
  first_name: string
  middle_name?: string | null
  last_name: string
}

export interface UserSearchResult {
  id: number
  username: string
  first_name: string
  middle_name?: string | null
  last_name: string
}

export interface CenterInvite {
  id: number
  token: string
  description: string
  max_uses: number
  uses: number
  expires_at: string
  created_at: string
  role: 'teacher' | 'student'
  group_id?: number | null
  is_head_teacher: boolean
}

export interface InviteContext {
  valid: boolean
  description: string
  role?: 'teacher' | 'student' | ''
  center_name?: string
  group_name?: string
}
```

Add `math_center_id?: number | null` to the existing `InvitationToken` interface.

- [ ] **Step 2:** Add keys to `keys.ts`:

```ts
  manageGroups: (centerId: number) => ['mathcenter', 'manage', centerId, 'groups'] as const,
  manageTeachers: (centerId: number) => ['mathcenter', 'manage', centerId, 'teachers'] as const,
  manageStudents: (centerId: number) => ['mathcenter', 'manage', centerId, 'students'] as const,
  manageInvites: (centerId: number) => ['mathcenter', 'manage', centerId, 'invites'] as const,
  userSearch: (centerId: number, q: string) => ['mathcenter', 'manage', centerId, 'user-search', q] as const,
  inviteContext: (token: string) => ['auth', 'invite', token] as const,
```

- [ ] **Step 3: Commit** `feat(shared): manage panel types + query keys`.

### Task 11: Manage query hooks

**Files:** Create `frontend/shared/src/queries/manage.ts`; re-export from the barrel.

- [ ] **Step 1:** Implement hooks against `'/mathcenter/centers/' + centerId + '/manage/...'`, mirroring `admin.ts` style. Cover: `useManageGroups`, `useManageCreateGroup`, `useManageDeleteGroup`; `useManageTeachers`, `useManageAddTeacher`, `useManageSetTeacherHead`, `useManageRemoveTeacher`; `useManageStudents`, `useManageAddStudent`, `useManageSetStudentGroup`, `useManageRemoveStudent`; `useUserSearch(centerId, q)` (`enabled: q.trim().length >= 2`); `useManageInvites`, `useManageCreateInvite`, `useManageRevokeInvite`; `useInviteContext(token)` → `client.request<InviteContext>('/auth/invite/' + encodeURIComponent(token))`, `enabled: token.length > 0`. Each mutation invalidates the matching key.

- [ ] **Step 2:** `npm --prefix frontend run typecheck` → green.

- [ ] **Step 3: Commit** `feat(shared): manage panel query hooks`.

### Task 12: Validation schemas

**Files:** Create `frontend/shared/src/validation/manage.ts`; re-export.

- [ ] **Step 1:** Zod schemas: `createGroupSchema` (name 1–50), `addTeacherSchema` (`user_id`, `is_head_teacher`), `addStudentSchema` (`user_id`, `group_id`), `createInviteSchema` (`role` enum, `group_id` optional, `is_head_teacher`, `description` max 255, `max_uses` int ≥1, `expires_in_hours` int ≥1, with a refine: `role === 'student' ⇒ group_id > 0`).

- [ ] **Step 2: Commit** `feat(shared): manage panel validation schemas`.

---

## Phase 3 — Frontend web UI

### Task 13: Manage page shell + route + nav

**Files:** Create `manage/manage-page.tsx`; modify `app/router.tsx`, `shell/use-nav-modules.ts`.

- [ ] **Step 1:** `ManagePage`: read `:centerId`; compute access from `useMathCenterMe()` — head teacher iff `teacher.centers.find(c => c.id === centerId)?.is_head_teacher`, OR `useAuth().user?.is_admin`. If no access → "Нет доступа" card. Else render a 3-tab switcher (local `useState<'groups'|'teachers'|'students'>`), rendering `GroupsTab`/`TeachersTab`/`StudentsTab`.

- [ ] **Step 2:** Route after the conduit route:

```tsx
{ path: 'mathcenter/:centerId/manage', element: <ManagePage /> },
```

- [ ] **Step 3:** In `use-nav-modules.ts`, track head-teacher centers and add the page:

```ts
  const headTeacherCenters = new Set<number>()
  for (const c of me.data?.teacher?.centers ?? []) {
    teacherCenters.add(c.id)
    if (c.is_head_teacher) headTeacherCenters.add(c.id)
    push(c.id, c.graduation_year)
  }
```

and append to `pages` (after Кондуит): `...(headTeacherCenters.has(c.id) ? [{ label: 'Управление', path: '/mathcenter/' + c.id + '/manage' }] : [])`. (Admins enrol themselves to see centers, matching today's Кондуит behavior.)

- [ ] **Step 4:** `npm --prefix frontend run typecheck && npm --prefix frontend run lint`.

- [ ] **Step 5: Commit** `feat(web): manage page shell + route + nav`.

### Task 14: Groups tab

**Files:** Create `manage/groups-tab.tsx`.

- [ ] **Step 1:** List groups (`useManageGroups`), inline create form (`useManageCreateGroup` + `createGroupSchema`), delete with a confirm (reuse the pattern from `features/admin/_shared.tsx` `ConfirmButton` if importable, else a simple `window.confirm`). Show member counts if available (skip — list endpoint returns groups only).

- [ ] **Step 2: Commit** `feat(web): manage groups tab`.

### Task 15: Invite section (shared) + user search select

**Files:** Create `manage/invite-section.tsx`, `manage/user-search-select.tsx`.

- [ ] **Step 1:** `UserSearchSelect`: debounced text input (300ms) → `useUserSearch(centerId, q)`; dropdown of results; `onSelect(user)`.

- [ ] **Step 2:** `InviteSection({ centerId, role })`: list `useManageInvites` filtered to `role`; each row shows description, uses/max, expiry, and a **copy-link** button that copies `${window.location.origin}/register?token=${invite.token}`; revoke button. A create form: description, max_uses, expires_in_hours, (`is_head_teacher` checkbox when `role==='teacher'`; group `<select>` when `role==='student'`, options from `useManageGroups`). Submit via `useManageCreateInvite`.

- [ ] **Step 3: Commit** `feat(web): invite section + user search`.

### Task 16: Teachers tab + Students tab

**Files:** Create `manage/teachers-tab.tsx`, `manage/students-tab.tsx`.

- [ ] **Step 1:** `TeachersTab`: roster from `useManageTeachers` (head badge, toggle head via `useManageSetTeacherHead`, remove via `useManageRemoveTeacher` — surface the 409 last-head message). "Добавить из пользователей": `UserSearchSelect` → `useManageAddTeacher` (with an is-head checkbox). Then `<InviteSection centerId role="teacher" />`.

- [ ] **Step 2:** `StudentsTab`: roster from `useManageStudents` grouped by `group_name`; per-student group `<select>` (move via `useManageSetStudentGroup`); remove. "Добавить из пользователей": `UserSearchSelect` + group select → `useManageAddStudent`. Then `<InviteSection centerId role="student" />`.

- [ ] **Step 3:** `npm --prefix frontend run typecheck && lint`.

- [ ] **Step 4: Commit** `feat(web): manage teachers + students tabs`.

### Task 17: Register page `?token=` pre-fill + context

**Files:** Modify `features/auth/register-page.tsx`.

- [ ] **Step 1:** Read the token from the URL: `const [params] = useSearchParams(); const urlToken = params.get('token') ?? ''`. Set it as the form default for `invitation_token`. When present, render the token `Input` as `readOnly` and show an info banner from `useInviteContext(urlToken)`: when `valid`, "Вы вступаете в «{center_name}» как {роль}{ группа {group_name}}"; when `!valid`, a muted warning "Приглашение недействительно или истекло". Plain `/register` keeps the editable field + autofocus.

- [ ] **Step 2:** Add a test (or extend `register`-related test if one exists) asserting the token field is pre-filled from `?token=`. (If no test infra for this page, do a manual preview check in Task 18.)

- [ ] **Step 3:** `npm --prefix frontend run typecheck && lint && npm --prefix frontend test`.

- [ ] **Step 4: Commit** `feat(web): register page reads ?token= invite links`.

---

## Phase 4 — Verification & landing

### Task 18: End-to-end verification

- [ ] Backend: `cd backend && /Users/alarion239/go/bin/sqlc generate && go build ./... && go test ./... && ~/go/bin/gofumpt -l internal/`. Rebuild backend container.
- [ ] Frontend: `npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test`.
- [ ] Preview (preview_start): as a head teacher open «Управление» → create a group; add a teacher from search; try removing the only head teacher → see the 409 message; add/move/remove a student; create a teacher invite and a student invite, copy a link; open `/register?token=…` logged out → banner shows the center/role, token locked. Capture `preview_screenshot` of the panel + the register banner.
- [ ] Fix any issues found, re-run checks.

### Task 19: Land on `main`

- [ ] Push the branch; `gh pr create`; after green, `gh pr merge --merge --delete-branch`; checkout main; pull.

---

## Self-review notes

- **Spec coverage:** Groups/Teachers/Students tabs (Tasks 14,16), assign-from-users (Task 15 search + add in 16), invite links (Tasks 7,8,15,17), head-teacher gate (Task 3), migration + scoping (Tasks 1,2,7), constrained presets (Task 7), last-head guard (Task 4), student group moves (Task 5), register `?token=` + context (Tasks 8,17). All spec sections map to tasks.
- **Type consistency:** `manageInviteView`(Go) ↔ `CenterInvite`(TS); `inviteContextView` ↔ `InviteContext`; `CreateInvitationTokenParams.MathCenterID *int64` used in both admin (nil) and manage (`&centerID`). Route base `/mathcenter/centers/{centerID}/manage` consistent between `ManageRouter` mount and the TS hooks.
- **Open follow-up baked into tasks:** add `GetInvitationTokenByID` query in Task 2 (used by `manageRevokeInvite` in Task 7) — ensure it's added during Task 2 sqlc edits.
