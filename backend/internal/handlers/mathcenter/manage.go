package mathcenter

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/internal/googlesheets"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/logger"
	mcdomain "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/internal/tokenpreset"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// ManageRouter is the head-teacher self-service panel, mounted under
// /centers/{centerID}/manage. Every handler re-checks head-teacher access (or
// admin) and that the target row belongs to {centerID}, so a head teacher of
// one center can never touch another center's rows via a guessed id.
func ManageRouter(database *db.DB, hub *live.Hub, sheetServices ...*googlesheets.Service) chi.Router {
	r := chi.NewRouter()
	sheets := googlesheets.NewDisabledService(database.Pool())
	if len(sheetServices) > 0 && sheetServices[0] != nil {
		sheets = sheetServices[0]
	}

	r.Get("/groups", manageListGroups(database))
	r.Post("/groups", manageCreateGroup(database, hub))
	r.Delete("/groups/{groupID}", manageDeleteGroup(database, hub))

	r.Get("/teachers", manageListTeachers(database))
	r.Post("/teachers", manageAddTeacher(database, hub))
	r.Patch("/teachers/{teacherID}/head", manageSetTeacherHead(database, hub))
	r.Delete("/teachers/{teacherID}", manageRemoveTeacher(database, hub))

	r.Get("/students", manageListStudents(database))
	r.Post("/students", manageAddStudent(database, hub))
	r.Patch("/students/{studentID}/group", manageSetStudentGroup(database, hub))
	r.Get("/razbor-access", manageListRazborAccess(database))
	r.Patch("/razbor-access", manageSetRazborAccessMatrix(database, hub))
	r.Get("/students/{studentID}/razbor-access", manageListStudentSeriesRazborAccess(database))
	r.Patch("/students/{studentID}/razbor-access", manageSetStudentRazborAccess(database, hub))
	r.Patch("/students/{studentID}/series/{seriesID}/razbor-access", manageSetStudentSeriesRazborAccess(database, hub))
	r.Delete("/students/{studentID}", manageRemoveStudent(database, hub))

	r.Get("/user-search", manageUserSearch(database))

	r.Get("/invites", manageListInvites(database))
	r.Post("/invites", manageCreateInvite(database))
	r.Delete("/invites/{tokenID}", manageRevokeInvite(database))

	// Google Sheets link configuration remains a head-teacher operation.
	r.Get("/google-sheets/links", manageGoogleSheetLinks(database, sheets))
	r.Post("/google-sheets/discover", manageGoogleSheetDiscover(database, sheets))
	r.Post("/google-sheets/links", manageGoogleSheetCreate(database, sheets))
	r.Patch("/google-sheets/links/{linkID}", manageGoogleSheetEnabled(database, sheets))
	r.Delete("/google-sheets/links/{linkID}", manageGoogleSheetDelete(database, sheets))
	r.Get("/google-sheets/runs", manageGoogleSheetRuns(database, sheets))
	r.Post("/google-sheets/sync-students", manageGoogleSheetSyncStudents(database, sheets))
	r.Post("/google-sheets/sync-series", manageGoogleSheetSyncSeries(database, sheets))
	r.Patch("/latex-preamble", UpdateLatexPreamble(database))

	return r
}

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

// manageGate resolves the {centerID} path param + the caller and runs the
// head-teacher check. On !ok the response is already written.
func manageGate(w http.ResponseWriter, r *http.Request, q *store.Queries) (centerID, userID int64, ok bool) {
	centerID, err := strconv.ParseInt(chi.URLParam(r, "centerID"), 10, 64)
	if err != nil {
		httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid center id")
		return 0, 0, false
	}
	userID, err = ctxcache.UserID(r.Context())
	if err != nil {
		httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeUnauthenticated, "unauthenticated")
		return 0, 0, false
	}
	if !requireHeadTeacher(r.Context(), w, r, q, userID, centerID) {
		return 0, 0, false
	}
	return centerID, userID, true
}

// Groups ---------------------------------------------------------------------

func manageListGroups(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		if termParam := r.URL.Query().Get("term_id"); termParam != "" {
			termID, err := strconv.ParseInt(termParam, 10, 64)
			if err != nil || termID <= 0 {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid term id")
				return
			}
			term, err := q.GetTerm(r.Context(), termID)
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && term.MathCenterID != centerID) {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid term id")
				return
			}
			if err != nil {
				logger.LogErrorContext(r.Context(), "manage: validate groups term", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list groups")
				return
			}
			groups, err := q.ListGroupsForTerm(r.Context(), termID)
			if err != nil {
				logger.LogErrorContext(r.Context(), "manage: list groups for term", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list groups")
				return
			}
			httpx.WriteJSON(w, http.StatusOK, groups)
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

func manageCreateGroup(database *db.DB, hub *live.Hub) http.HandlerFunc {
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
		group, err := mcdomain.CreateGroupForCurrentTerm(
			r.Context(), database.Pool(), centerID, name, time.Now(),
		)
		if err != nil {
			if errors.Is(err, mcdomain.ErrCohortOutsideMathCenterGrades) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "this center has no term and its cohort is not currently in grades 5–11")
				return
			}
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "group with that name already exists")
				return
			}
			logger.LogErrorContext(r.Context(), "manage: create group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create group")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		httpx.WriteJSON(w, http.StatusCreated, group)
	}
}

func manageDeleteGroup(database *db.DB, hub *live.Hub) http.HandlerFunc {
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
		if !groupInCenter(w, r, q, groupID, centerID) {
			return
		}
		if _, err := q.DeleteMathCenterGroup(r.Context(), groupID); err != nil {
			logger.LogErrorContext(r.Context(), "manage: delete group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to delete group")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		w.WriteHeader(http.StatusNoContent)
	}
}

// Teachers -------------------------------------------------------------------

type manageAddTeacherRequest struct {
	UserID        int64 `json:"user_id"`
	IsHeadTeacher bool  `json:"is_head_teacher"`
}

type manageSetHeadRequest struct {
	IsHeadTeacher bool `json:"is_head_teacher"`
}

func manageListTeachers(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		teachers, err := q.ListTeachersForCenter(r.Context(), centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: list teachers", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list teachers")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, teachers)
	}
}

// manageAddTeacher enrolls an existing user as a teacher of {centerID}. Mirrors
// admin.AddTeacher: per-center exclusivity (no student+teacher of the same
// center) inside one transaction.
func manageAddTeacher(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		centerID, _, ok := manageGate(w, r, store.New(database.Pool()))
		if !ok {
			return
		}
		var req manageAddTeacherRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.UserID == 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "user_id required")
			return
		}

		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "manage: begin add-teacher tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := store.New(tx)

		isStudent, err := q.IsStudentInCenter(ctx, store.IsStudentInCenterParams{
			UserID: req.UserID, MathCenterID: centerID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "manage: add-teacher student check", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add teacher")
			return
		}
		if isStudent {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "user is a student of this center and cannot also teach it")
			return
		}

		t, err := q.AddTeacherToCenter(ctx, store.AddTeacherToCenterParams{
			UserID: req.UserID, MathCenterID: centerID, IsHeadTeacher: req.IsHeadTeacher,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "user is already a teacher of this center")
				return
			}
			if isFKViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "user does not exist")
				return
			}
			logger.LogErrorContext(ctx, "manage: add teacher", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add teacher")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(ctx, "manage: commit add-teacher tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		httpx.WriteJSON(w, http.StatusCreated, t)
	}
}

func manageSetTeacherHead(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		teacherID, err := strconv.ParseInt(chi.URLParam(r, "teacherID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid teacher id")
			return
		}
		var req manageSetHeadRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		teacher, ok := teacherInCenter(w, r, q, teacherID, centerID)
		if !ok {
			return
		}
		// Demoting the last head teacher would lock the center out of its own
		// management panel.
		if !req.IsHeadTeacher && !guardLastHead(r.Context(), w, r, q, centerID, teacher) {
			return
		}
		if _, err := q.SetTeacherHead(r.Context(), store.SetTeacherHeadParams{
			ID: teacherID, IsHeadTeacher: req.IsHeadTeacher,
		}); err != nil {
			logger.LogErrorContext(r.Context(), "manage: set head", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to update teacher")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		w.WriteHeader(http.StatusNoContent)
	}
}

func manageRemoveTeacher(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		teacherID, err := strconv.ParseInt(chi.URLParam(r, "teacherID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid teacher id")
			return
		}
		teacher, ok := teacherInCenter(w, r, q, teacherID, centerID)
		if !ok {
			return
		}
		if !guardLastHead(r.Context(), w, r, q, centerID, teacher) {
			return
		}
		if _, err := q.RemoveTeacher(r.Context(), teacherID); err != nil {
			logger.LogErrorContext(r.Context(), "manage: remove teacher", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to remove teacher")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		w.WriteHeader(http.StatusNoContent)
	}
}

// Students -------------------------------------------------------------------

type manageAddStudentRequest struct {
	UserID  int64 `json:"user_id"`
	GroupID int64 `json:"group_id"`
}

type manageSetGroupRequest struct {
	GroupID int64 `json:"group_id"`
}

type manageSetRazborAccessRequest struct {
	CanViewRazbors *bool `json:"can_view_razbors"`
}

type manageSetSeriesRazborAccessRequest struct {
	CanViewVideo  *bool `json:"can_view_video"`
	CanViewPDFTex *bool `json:"can_view_pdf_tex"`
}

type manageRazborAccessResponse struct {
	Series   []manageRazborSeries  `json:"series"`
	Groups   []manageRazborGroup   `json:"groups"`
	Students []manageRazborStudent `json:"students"`
	Cells    []manageRazborCell    `json:"cells"`
}

type manageRazborSeries struct {
	SeriesID      int64  `json:"series_id"`
	SeriesNumber  int32  `json:"series_number"`
	SeriesName    string `json:"series_name"`
	WrittenPosted bool   `json:"written_posted"`
	VideoPosted   bool   `json:"video_posted"`
}

type manageRazborGroup struct {
	ID                  int64  `json:"id"`
	Name                string `json:"name"`
	RazborDefaultVideo  bool   `json:"razbor_default_video"`
	RazborDefaultPdfTex bool   `json:"razbor_default_pdf_tex"`
}

type manageRazborStudent struct {
	StudentID           int64  `json:"student_id"`
	UserID              int64  `json:"user_id"`
	GroupID             int64  `json:"group_id"`
	GroupName           string `json:"group_name"`
	Name                string `json:"name"`
	RazborDefaultVideo  bool   `json:"razbor_default_video"`
	RazborDefaultPdfTex bool   `json:"razbor_default_pdf_tex"`
}

type manageRazborCell struct {
	StudentID     int64 `json:"student_id"`
	GroupID       int64 `json:"group_id"`
	SeriesID      int64 `json:"series_id"`
	CanViewVideo  bool  `json:"can_view_video"`
	CanViewPdfTex bool  `json:"can_view_pdf_tex"`
}

type manageRazborMatrixRequest struct {
	Target    string `json:"target"`
	Mode      string `json:"mode"`
	Format    string `json:"format"`
	SeriesID  int64  `json:"series_id"`
	StudentID int64  `json:"student_id"`
	GroupID   int64  `json:"group_id"`
	Allowed   *bool  `json:"allowed"`
}

func manageListStudents(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		students, err := q.ListStudentsForCenter(r.Context(), centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: list students", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list students")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, students)
	}
}

func manageListRazborAccess(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		ctx := r.Context()
		series, err := q.ListRazborAccessSeriesForManage(ctx, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "manage: list razbor series", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to load razbor access")
			return
		}
		groups, err := q.ListRazborAccessGroupsForManage(ctx, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "manage: list razbor groups", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to load razbor access")
			return
		}
		students, err := q.ListRazborAccessStudentsForManage(ctx, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "manage: list razbor students", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to load razbor access")
			return
		}
		cells, err := q.ListRazborAccessCellsForManage(ctx, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "manage: list razbor cells", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to load razbor access")
			return
		}
		out := manageRazborAccessResponse{
			Series:   make([]manageRazborSeries, 0, len(series)),
			Groups:   make([]manageRazborGroup, 0, len(groups)),
			Students: make([]manageRazborStudent, 0, len(students)),
			Cells:    make([]manageRazborCell, 0, len(cells)),
		}
		for _, item := range series {
			out.Series = append(out.Series, manageRazborSeries{
				SeriesID: item.SeriesID, SeriesNumber: item.SeriesNumber, SeriesName: item.SeriesName,
				WrittenPosted: item.WrittenPosted, VideoPosted: item.VideoPosted,
			})
		}
		for _, item := range groups {
			out.Groups = append(out.Groups, manageRazborGroup{
				ID: item.ID, Name: item.Name,
				RazborDefaultVideo:  item.RazborDefaultVideo,
				RazborDefaultPdfTex: item.RazborDefaultPdfTex,
			})
		}
		for _, item := range students {
			name := strings.TrimSpace(strings.Join([]string{item.FirstName, stringValue(item.MiddleName), item.LastName}, " "))
			out.Students = append(out.Students, manageRazborStudent{
				StudentID: item.StudentID, UserID: item.UserID, GroupID: item.GroupID,
				GroupName: item.GroupName, Name: name,
				RazborDefaultVideo:  item.RazborDefaultVideo,
				RazborDefaultPdfTex: item.RazborDefaultPdfTex,
			})
		}
		for _, item := range cells {
			out.Cells = append(out.Cells, manageRazborCell{
				StudentID: item.StudentID, GroupID: item.GroupID, SeriesID: item.SeriesID,
				CanViewVideo: item.CanViewVideo, CanViewPdfTex: item.CanViewPdfTex,
			})
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func manageSetRazborAccessMatrix(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		var req manageRazborMatrixRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Allowed == nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "allowed required")
			return
		}
		if req.Format != "video" && req.Format != "pdf_tex" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "format must be video or pdf_tex")
			return
		}
		if req.Mode != "series" && req.Mode != "default" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "mode must be series or default")
			return
		}
		if req.Target != "term" && req.Target != "group" && req.Target != "student" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "target must be term, group, or student")
			return
		}
		if req.Mode == "default" && req.SeriesID != 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "series_id is only valid for series mode")
			return
		}
		if req.Target == "student" {
			if req.StudentID == 0 || !studentInCenter(w, r, q, req.StudentID, centerID) {
				return
			}
		}
		if req.Target == "group" {
			if req.GroupID == 0 || !groupInCenter(w, r, q, req.GroupID, centerID) {
				return
			}
		}

		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "manage: begin razbor matrix tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		qx := store.New(tx)
		var affected int64
		if req.Mode == "series" {
			switch req.Target {
			case "student":
				affected, err = qx.SetStudentRazborMatrixSeries(ctx, store.SetStudentRazborMatrixSeriesParams{
					Format: req.Format, Allowed: *req.Allowed, StudentID: req.StudentID, SeriesID: req.SeriesID,
				})
			case "group":
				affected, err = qx.SetGroupRazborMatrixSeries(ctx, store.SetGroupRazborMatrixSeriesParams{
					Format: req.Format, Allowed: *req.Allowed, GroupID: req.GroupID, SeriesID: req.SeriesID,
				})
			case "term":
				affected, err = qx.SetTermRazborMatrixSeries(ctx, store.SetTermRazborMatrixSeriesParams{
					Format: req.Format, Allowed: *req.Allowed, MathCenterID: centerID, SeriesID: req.SeriesID,
				})
			}
		} else {
			switch req.Target {
			case "student":
				if req.Format == "video" {
					affected, err = qx.SetStudentRazborDefaultVideo(ctx, store.SetStudentRazborDefaultVideoParams{Allowed: *req.Allowed, StudentID: req.StudentID})
				} else {
					affected, err = qx.SetStudentRazborDefaultPDFTex(ctx, store.SetStudentRazborDefaultPDFTexParams{Allowed: *req.Allowed, StudentID: req.StudentID})
				}
			case "group":
				if req.Format == "video" {
					affected, err = qx.SetGroupRazborDefaultVideo(ctx, store.SetGroupRazborDefaultVideoParams{Allowed: *req.Allowed, GroupID: req.GroupID})
					if err == nil {
						err = qx.SetStudentsRazborDefaultVideoForGroup(ctx, store.SetStudentsRazborDefaultVideoForGroupParams{Allowed: *req.Allowed, GroupID: req.GroupID})
					}
				} else {
					affected, err = qx.SetGroupRazborDefaultPDFTex(ctx, store.SetGroupRazborDefaultPDFTexParams{Allowed: *req.Allowed, GroupID: req.GroupID})
					if err == nil {
						err = qx.SetStudentsRazborDefaultPDFTexForGroup(ctx, store.SetStudentsRazborDefaultPDFTexForGroupParams{Allowed: *req.Allowed, GroupID: req.GroupID})
					}
				}
			case "term":
				if req.Format == "video" {
					err = qx.SetGroupsRazborDefaultVideoForCenter(ctx, store.SetGroupsRazborDefaultVideoForCenterParams{Allowed: *req.Allowed, MathCenterID: centerID})
					if err == nil {
						err = qx.SetStudentsRazborDefaultVideoForCenter(ctx, store.SetStudentsRazborDefaultVideoForCenterParams{Allowed: *req.Allowed, MathCenterID: centerID})
					}
				} else {
					err = qx.SetGroupsRazborDefaultPDFTexForCenter(ctx, store.SetGroupsRazborDefaultPDFTexForCenterParams{Allowed: *req.Allowed, MathCenterID: centerID})
					if err == nil {
						err = qx.SetStudentsRazborDefaultPDFTexForCenter(ctx, store.SetStudentsRazborDefaultPDFTexForCenterParams{Allowed: *req.Allowed, MathCenterID: centerID})
					}
				}
				if err == nil {
					affected = 1
				}
			}
		}
		if err != nil {
			logger.LogErrorContext(ctx, "manage: set razbor matrix", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to change razbor access")
			return
		}
		if req.Mode == "series" && affected == 0 {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "target is not in the active term")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(ctx, "manage: commit razbor matrix", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: centerID, Kind: live.KindCoffins})
		w.WriteHeader(http.StatusNoContent)
	}
}

// manageAddStudent enrolls an existing user into a group of {centerID}. Mirrors
// admin.AddStudent, plus a guard that the target group belongs to this center.
func manageAddStudent(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		centerID, _, ok := manageGate(w, r, store.New(database.Pool()))
		if !ok {
			return
		}
		var req manageAddStudentRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.UserID == 0 || req.GroupID == 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "user_id and group_id required")
			return
		}

		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "manage: begin add-student tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := store.New(tx)

		group, err := q.GetGroup(ctx, req.GroupID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "group not found")
				return
			}
			logger.LogErrorContext(ctx, "manage: get group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add student")
			return
		}
		if group.MathCenterID != centerID {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "group not found")
			return
		}

		isTeacher, err := q.IsTeacherInCenter(ctx, store.IsTeacherInCenterParams{
			UserID: req.UserID, MathCenterID: centerID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "manage: add-student teacher check", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add student")
			return
		}
		if isTeacher {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "user is a teacher of this center and cannot also be a student there")
			return
		}

		s, err := q.AddStudentToGroup(ctx, store.AddStudentToGroupParams{
			UserID: req.UserID, GroupID: req.GroupID,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "user is already a student in some group")
				return
			}
			if isFKViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "user does not exist")
				return
			}
			logger.LogErrorContext(ctx, "manage: add student", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add student")
			return
		}
		if err := q.InitializeStudentRazborAccess(ctx, s.ID); err != nil {
			logger.LogErrorContext(ctx, "manage: initialize student razbor access", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add student")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(ctx, "manage: commit add-student tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		httpx.WriteJSON(w, http.StatusCreated, s)
	}
}

// manageSetStudentGroup moves a student to another group within the SAME center.
func manageSetStudentGroup(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		studentID, err := strconv.ParseInt(chi.URLParam(r, "studentID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid student id")
			return
		}
		var req manageSetGroupRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.GroupID == 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "group_id required")
			return
		}
		// The student must currently belong to this center, and the target group
		// must too — so a move can never relocate a student across centers.
		if !studentInCenter(w, r, q, studentID, centerID) {
			return
		}
		if !groupInCenter(w, r, q, req.GroupID, centerID) {
			return
		}
		if _, err := q.SetStudentGroup(r.Context(), store.SetStudentGroupParams{
			ID: studentID, GroupID: req.GroupID,
		}); err != nil {
			logger.LogErrorContext(r.Context(), "manage: set student group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to move student")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		w.WriteHeader(http.StatusNoContent)
	}
}

// manageSetStudentRazborAccess changes only the selected current-term
// enrollment. The database default remains open, so no student is restricted
// unless a head teacher explicitly uses this control.
func manageSetStudentRazborAccess(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		studentID, err := strconv.ParseInt(chi.URLParam(r, "studentID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid student id")
			return
		}
		var req manageSetRazborAccessRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.CanViewRazbors == nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "can_view_razbors required")
			return
		}
		if !studentInCenter(w, r, q, studentID, centerID) {
			return
		}
		if _, err := q.SetStudentRazborAccess(r.Context(), store.SetStudentRazborAccessParams{
			ID: studentID, CanViewRazbors: *req.CanViewRazbors,
		}); err != nil {
			logger.LogErrorContext(r.Context(), "manage: set student razbor access", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to change razbor access")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		w.WriteHeader(http.StatusNoContent)
	}
}

func manageListStudentSeriesRazborAccess(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		studentID, err := strconv.ParseInt(chi.URLParam(r, "studentID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid student id")
			return
		}
		if !studentInCenter(w, r, q, studentID, centerID) {
			return
		}
		rows, err := q.ListStudentSeriesRazborAccessForManage(r.Context(), studentID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: list student series razbor access", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to load razbor access")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, rows)
	}
}

func manageSetStudentSeriesRazborAccess(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		studentID, err := strconv.ParseInt(chi.URLParam(r, "studentID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid student id")
			return
		}
		seriesID, err := strconv.ParseInt(chi.URLParam(r, "seriesID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid series id")
			return
		}
		var req manageSetSeriesRazborAccessRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.CanViewVideo == nil || req.CanViewPDFTex == nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "both razbor access fields are required")
			return
		}
		if !studentInCenter(w, r, q, studentID, centerID) {
			return
		}
		affected, err := q.SetStudentSeriesRazborAccess(r.Context(), store.SetStudentSeriesRazborAccessParams{
			ID:            studentID,
			ID_2:          seriesID,
			CanViewVideo:  *req.CanViewVideo,
			CanViewPdfTex: *req.CanViewPDFTex,
		})
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: set student series razbor access", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to change razbor access")
			return
		}
		if affected == 0 {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found for this student")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindCoffins})
		w.WriteHeader(http.StatusNoContent)
	}
}

func manageRemoveStudent(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		studentID, err := strconv.ParseInt(chi.URLParam(r, "studentID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid student id")
			return
		}
		if !studentInCenter(w, r, q, studentID, centerID) {
			return
		}
		if _, err := q.RemoveStudent(r.Context(), studentID); err != nil {
			logger.LogErrorContext(r.Context(), "manage: remove student", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to remove student")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		w.WriteHeader(http.StatusNoContent)
	}
}

// User search ----------------------------------------------------------------

func manageUserSearch(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		if _, _, ok := manageGate(w, r, q); !ok {
			return
		}
		query := strings.TrimSpace(r.URL.Query().Get("q"))
		if len(query) < 2 {
			httpx.WriteJSON(w, http.StatusOK, []store.SearchUsersRow{})
			return
		}
		rows, err := q.SearchUsers(r.Context(), query)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: user search", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to search users")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, rows)
	}
}

// Invites --------------------------------------------------------------------

type manageInviteView struct {
	ID          int64     `json:"id"`
	Token       string    `json:"token"`
	Description string    `json:"description"`
	MaxUses     int32     `json:"max_uses"`
	Uses        int64     `json:"uses"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
	Role        string    `json:"role"`
	GroupID     *int64    `json:"group_id,omitempty"`
	IsHead      bool      `json:"is_head_teacher"`
}

type manageCreateInviteRequest struct {
	Role           string `json:"role"`
	GroupID        int64  `json:"group_id"`
	IsHeadTeacher  bool   `json:"is_head_teacher"`
	Description    string `json:"description"`
	MaxUses        int32  `json:"max_uses"`
	ExpiresInHours int    `json:"expires_in_hours"`
}

func manageListInvites(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		tokens, err := q.ListInvitationTokensForCenter(r.Context(), &centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: list invites", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list invites")
			return
		}
		out := make([]manageInviteView, 0, len(tokens))
		for _, t := range tokens {
			uses, err := q.CountUsesOfInvitationToken(r.Context(), t.ID)
			if err != nil {
				logger.LogErrorContext(r.Context(), "manage: count invite uses", err, "token_id", t.ID)
				uses = 0
			}
			view := manageInviteView{
				ID: t.ID, Token: t.Token, Description: t.Description,
				MaxUses: t.MaxUses, Uses: uses, ExpiresAt: t.ExpiresAt, CreatedAt: t.CreatedAt,
			}
			if preset, err := tokenpreset.Parse(t.Preset); err == nil {
				switch {
				case preset.MathCenterTeacher != nil:
					view.Role = "teacher"
					view.IsHead = preset.MathCenterTeacher.IsHeadTeacher
				case preset.MathCenterStudent != nil:
					view.Role = "student"
					gid := preset.MathCenterStudent.GroupID
					view.GroupID = &gid
				}
			}
			out = append(out, view)
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// manageCreateInvite mints a center-scoped invitation token. The preset is built
// SERVER-SIDE from role+group — the client never supplies a raw preset — so a
// head teacher cannot grant admin or bind the token to another center.
func manageCreateInvite(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		var req manageCreateInviteRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.MaxUses <= 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "max_uses must be > 0")
			return
		}
		if req.ExpiresInHours <= 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "expires_in_hours must be > 0")
			return
		}
		if len(req.Description) > 255 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "description too long")
			return
		}

		var preset tokenpreset.Preset
		switch req.Role {
		case "teacher":
			preset.MathCenterTeacher = &tokenpreset.MathCenterTeacher{
				CenterID: centerID, IsHeadTeacher: req.IsHeadTeacher,
			}
		case "student":
			if !groupInCenter(w, r, q, req.GroupID, centerID) {
				return
			}
			preset.MathCenterStudent = &tokenpreset.MathCenterStudent{GroupID: req.GroupID}
		default:
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "role must be teacher or student")
			return
		}

		if err := tokenpreset.Validate(r.Context(), q, preset); err != nil {
			if errors.Is(err, tokenpreset.ErrInvalidPreset) {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
				return
			}
			logger.LogErrorContext(r.Context(), "manage: validate invite preset", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create invite")
			return
		}
		presetJSON, err := tokenpreset.Marshal(preset)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: marshal invite preset", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create invite")
			return
		}
		raw, err := randomHexToken(32)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: random token", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create invite")
			return
		}

		tok, err := q.CreateInvitationToken(r.Context(), store.CreateInvitationTokenParams{
			Token:        raw,
			Description:  req.Description,
			MaxUses:      req.MaxUses,
			ExpiresAt:    time.Now().Add(time.Duration(req.ExpiresInHours) * time.Hour),
			Preset:       presetJSON,
			MathCenterID: &centerID,
		})
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: create invite", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create invite")
			return
		}

		view := manageInviteView{
			ID: tok.ID, Token: tok.Token, Description: tok.Description,
			MaxUses: tok.MaxUses, Uses: 0, ExpiresAt: tok.ExpiresAt, CreatedAt: tok.CreatedAt,
			Role: req.Role, IsHead: req.IsHeadTeacher,
		}
		if req.Role == "student" {
			gid := req.GroupID
			view.GroupID = &gid
		}
		httpx.WriteJSON(w, http.StatusCreated, view)
	}
}

func manageRevokeInvite(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		tokenID, err := strconv.ParseInt(chi.URLParam(r, "tokenID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid token id")
			return
		}
		tok, err := q.GetInvitationTokenByID(r.Context(), tokenID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "invite not found")
				return
			}
			logger.LogErrorContext(r.Context(), "manage: get invite", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if tok.MathCenterID == nil || *tok.MathCenterID != centerID {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "invite not found")
			return
		}
		if _, err := q.RevokeInvitationTokenByID(r.Context(), tokenID); err != nil {
			logger.LogErrorContext(r.Context(), "manage: revoke invite", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to revoke invite")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// helpers --------------------------------------------------------------------

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// groupInCenter loads a group and confirms it belongs to {centerID}. On any
// mismatch it writes 404 and returns false. Foreign groups are reported as "not
// found" rather than "forbidden" so a head teacher cannot probe other centers.
func groupInCenter(w http.ResponseWriter, r *http.Request, q *store.Queries, groupID, centerID int64) bool {
	group, err := q.GetGroup(r.Context(), groupID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "group not found")
			return false
		}
		logger.LogErrorContext(r.Context(), "manage: get group", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return false
	}
	if group.MathCenterID != centerID {
		httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "group not found")
		return false
	}
	return true
}

func teacherInCenter(w http.ResponseWriter, r *http.Request, q *store.Queries, teacherID, centerID int64) (store.MathCenterTeacher, bool) {
	teacher, err := q.GetTeacher(r.Context(), teacherID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "teacher not found")
			return store.MathCenterTeacher{}, false
		}
		logger.LogErrorContext(r.Context(), "manage: get teacher", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterTeacher{}, false
	}
	if teacher.MathCenterID != centerID {
		httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "teacher not found")
		return store.MathCenterTeacher{}, false
	}
	return teacher, true
}

// studentInCenter confirms the student row belongs to {centerID} by resolving
// its group's center.
func studentInCenter(w http.ResponseWriter, r *http.Request, q *store.Queries, studentID, centerID int64) bool {
	student, err := q.GetStudent(r.Context(), studentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "student not found")
			return false
		}
		logger.LogErrorContext(r.Context(), "manage: get student", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return false
	}
	return groupInCenter(w, r, q, student.GroupID, centerID)
}

// guardLastHead returns false (and writes 409) if removing/demoting {teacher}
// would leave the center with zero head teachers.
func guardLastHead(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, centerID int64, teacher store.MathCenterTeacher) bool {
	if !teacher.IsHeadTeacher {
		return true
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

func isFKViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

// randomHexToken returns 2*n hex chars of cryptographically random data, the
// same shape as the admin token generator.
func randomHexToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
