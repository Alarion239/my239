package mathcenter

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// MeResponse is the union view for the calling user. Exactly one of Teacher /
// Student may be populated; both nil means the user is not enrolled in any
// math center role.
type MeResponse struct {
	Teacher *TeacherView `json:"teacher,omitempty"`
	Student *StudentView `json:"student,omitempty"`
}

type CenterInfo struct {
	ID             int64 `json:"id"`
	GraduationYear int   `json:"graduation_year"`
	Grade          int   `json:"grade"`
}

type GroupInfo struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type TeacherInfo struct {
	UserID        int64  `json:"user_id"`
	DisplayName   string `json:"display_name"`
	IsHeadTeacher bool   `json:"is_head_teacher"`
}

type StudentInfo struct {
	UserID      int64  `json:"user_id"`
	DisplayName string `json:"display_name"`
}

type GroupWithStudents struct {
	ID       int64         `json:"id"`
	Name     string        `json:"name"`
	Students []StudentInfo `json:"students"`
}

type TeacherCenterView struct {
	ID             int64               `json:"id"`
	GraduationYear int                 `json:"graduation_year"`
	Grade          int                 `json:"grade"`
	IsHeadTeacher  bool                `json:"is_head_teacher"`
	Teachers       []TeacherInfo       `json:"teachers"`
	Groups         []GroupWithStudents `json:"groups"`
}

type TeacherView struct {
	Centers []TeacherCenterView `json:"centers"`
}

type StudentView struct {
	Center       CenterInfo    `json:"center"`
	Group        GroupInfo     `json:"group"`
	HeadTeachers []TeacherInfo `json:"head_teachers"`
}

// Me returns the math center view appropriate to the calling user. Teachers
// see every member of every center they teach. Students see their group
// roster only as far as the head teachers — peers are intentionally hidden.
func Me(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, err := ctxcache.UserID(ctx)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeUnauthenticated, "unauthenticated")
			return
		}

		q := store.New(database.Pool())
		now := time.Now()
		resp := MeResponse{}

		if tv, err := buildTeacherView(ctx, q, userID, now); err != nil {
			logger.LogErrorContext(ctx, "mathcenter: build teacher view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		} else if tv != nil {
			resp.Teacher = tv
		}

		if sv, err := buildStudentView(ctx, q, userID, now); err != nil {
			logger.LogErrorContext(ctx, "mathcenter: build student view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		} else if sv != nil {
			resp.Student = sv
		}

		httpx.WriteJSON(w, http.StatusOK, resp)
	}
}

func buildTeacherView(ctx context.Context, q *store.Queries, userID int64, now time.Time) (*TeacherView, error) {
	centers, err := q.ListCentersForTeacher(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list centers for teacher: %w", err)
	}
	if len(centers) == 0 {
		return nil, nil
	}

	// Fetch all members of all centers in three queries (instead of 3N), then
	// bucket by center id in Go.
	centerIDs := make([]int64, len(centers))
	for i, c := range centers {
		centerIDs[i] = c.ID
	}
	teachers, err := q.ListTeachersForCenters(ctx, centerIDs)
	if err != nil {
		return nil, fmt.Errorf("list teachers for centers: %w", err)
	}
	groups, err := q.ListGroupsForCenters(ctx, centerIDs)
	if err != nil {
		return nil, fmt.Errorf("list groups for centers: %w", err)
	}
	students, err := q.ListStudentsForCenters(ctx, centerIDs)
	if err != nil {
		return nil, fmt.Errorf("list students for centers: %w", err)
	}

	teachersByCenter := make(map[int64][]TeacherInfo, len(centers))
	for _, t := range teachers {
		teachersByCenter[t.MathCenterID] = append(teachersByCenter[t.MathCenterID], TeacherInfo{
			UserID:        t.UserID,
			DisplayName:   mc.TeacherDisplayName(t.FirstName, t.MiddleName),
			IsHeadTeacher: t.IsHeadTeacher,
		})
	}
	groupsByCenter := make(map[int64][]store.MathCenterGroup, len(centers))
	for _, g := range groups {
		groupsByCenter[g.MathCenterID] = append(groupsByCenter[g.MathCenterID], g)
	}
	studentsByGroup := make(map[int64][]StudentInfo, len(groups))
	for _, s := range students {
		studentsByGroup[s.GroupID] = append(studentsByGroup[s.GroupID], StudentInfo{
			UserID:      s.UserID,
			DisplayName: mc.StudentDisplayName(s.FirstName, s.LastName),
		})
	}

	out := &TeacherView{Centers: make([]TeacherCenterView, 0, len(centers))}
	for _, c := range centers {
		groupViews := make([]GroupWithStudents, 0, len(groupsByCenter[c.ID]))
		for _, g := range groupsByCenter[c.ID] {
			groupViews = append(groupViews, GroupWithStudents{
				ID:       g.ID,
				Name:     g.Name,
				Students: nilToEmpty(studentsByGroup[g.ID]),
			})
		}

		out.Centers = append(out.Centers, TeacherCenterView{
			ID:             c.ID,
			GraduationYear: int(c.GraduationYear),
			Grade:          mc.Grade(int(c.GraduationYear), now),
			IsHeadTeacher:  c.IsHeadTeacher,
			Teachers:       teachersByCenter[c.ID],
			Groups:         groupViews,
		})
	}
	return out, nil
}

func buildStudentView(ctx context.Context, q *store.Queries, userID int64, now time.Time) (*StudentView, error) {
	row, err := q.GetStudentByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get student by user id: %w", err)
	}

	heads, err := q.ListHeadTeachersForCenter(ctx, row.MathCenterID)
	if err != nil {
		return nil, fmt.Errorf("list head teachers for center: %w", err)
	}
	headInfos := make([]TeacherInfo, 0, len(heads))
	for _, h := range heads {
		headInfos = append(headInfos, TeacherInfo{
			UserID:        h.UserID,
			DisplayName:   mc.TeacherDisplayName(h.FirstName, h.MiddleName),
			IsHeadTeacher: true,
		})
	}

	return &StudentView{
		Center: CenterInfo{
			ID:             row.MathCenterID,
			GraduationYear: int(row.GraduationYear),
			Grade:          mc.Grade(int(row.GraduationYear), now),
		},
		Group: GroupInfo{
			ID:   row.GroupID,
			Name: row.GroupName,
		},
		HeadTeachers: headInfos,
	}, nil
}

// nilToEmpty keeps the JSON output as `[]` rather than `null` for the
// no-students case, matching how empty arrays look elsewhere in the API.
func nilToEmpty(s []StudentInfo) []StudentInfo {
	if s == nil {
		return []StudentInfo{}
	}
	return s
}
