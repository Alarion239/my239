// Package seed generates a self-contained demo dataset (a math center with
// groups, teachers, students, published series, and homework submissions spread
// across every status) so the app can be exercised end-to-end without manual
// setup. It is admin-triggered (see handlers/admin) and resets itself: each run
// deletes the previous demo data before recreating a fresh, deterministic set.
//
// "Demo data" is anything under the sentinel graduation year DemoGraduationYear
// plus any non-admin user whose username starts with "demo-". Nothing else is
// touched.
package seed

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/Alarion239/my239/backend/internal/auth"
	hw "github.com/Alarion239/my239/backend/internal/homework"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
)

const (
	// DemoGraduationYear is the sentinel cohort that owns all demo data. Far
	// enough in the future that it won't collide with a real center.
	DemoGraduationYear = 2099
	// DemoPassword is shared by every seeded login so testers can sign in
	// without juggling credentials. Demo accounts are never admins.
	DemoPassword = "demo1234"
	// demoUsernamePrefix tags seeded users so teardown can find them.
	demoUsernamePrefix = "demo-"

	demoStudents = 6
	demoGroups   = 2
)

// Login is one seeded account a tester can sign in as.
type Login struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	Name     string `json:"name"`
}

// Result is the summary returned to the admin UI after a run.
type Result struct {
	GraduationYear int     `json:"graduation_year"`
	Groups         int     `json:"groups"`
	Teachers       int     `json:"teachers"`
	Students       int     `json:"students"`
	Series         int     `json:"series"`
	Problems       int     `json:"problems"`
	Subproblems    int     `json:"subproblems"`
	Submissions    int     `json:"submissions"`
	Password       string  `json:"password"`
	Logins         []Login `json:"logins"`
}

// subState is the homework status to seed for one (student, subproblem) pair.
type subState int

const (
	stUntouched subState = iota
	stSubmitted
	stUnderReview
	stAccepted
	stRejected
	stAppealed
)

// stateCycle is walked deterministically across (student, subproblem) pairs so
// every status is represented, including untouched (no thread at all).
var stateCycle = []subState{stAccepted, stSubmitted, stRejected, stUnderReview, stAppealed, stUntouched}

// subInfo is a created subproblem plus the series it belongs to, for seeding
// submissions against it.
type subInfo struct {
	id       int64
	seriesID int64
}

// seeder carries the per-run state. The transaction is supplied via db (used
// both for the generated store and for the few raw maintenance statements).
type seeder struct {
	db         store.DBTX
	q          *store.Queries
	pwHash     string
	centerID   int64
	teacherID  int64   // the regular teacher, used as grader/actor on graded events
	studentIDs []int64 // seeded students, in creation order
	subs       []subInfo
	res        Result
}

// Run resets any previous demo data and seeds a fresh dataset. db must be a
// transaction (the caller commits on success, rolls back on error).
func Run(ctx context.Context, db store.DBTX) (*Result, error) {
	pwHash, err := auth.HashPassword(DemoPassword)
	if err != nil {
		return nil, fmt.Errorf("seed: hash password: %w", err)
	}
	s := &seeder{
		db:     db,
		q:      store.New(db),
		pwHash: pwHash,
		res:    Result{GraduationYear: DemoGraduationYear, Password: DemoPassword},
	}
	if err := s.teardown(ctx); err != nil {
		return nil, err
	}
	if err := s.build(ctx); err != nil {
		return nil, err
	}
	return &s.res, nil
}

// teardown removes the previous demo set. Delete the center first: cascades
// wipe its groups, enrollments, series, problems, subproblems, threads and
// events — so no homework event still references a demo user as its actor
// (that FK is ON DELETE RESTRICT) by the time we delete the demo users.
func (s *seeder) teardown(ctx context.Context) error {
	if _, err := s.db.Exec(ctx,
		`DELETE FROM math_centers WHERE graduation_year = $1`, int32(DemoGraduationYear)); err != nil {
		return fmt.Errorf("seed: delete demo center: %w", err)
	}
	if _, err := s.db.Exec(ctx,
		`DELETE FROM users WHERE username LIKE $1 AND is_admin = FALSE`, demoUsernamePrefix+"%"); err != nil {
		return fmt.Errorf("seed: delete demo users: %w", err)
	}
	return nil
}

func (s *seeder) build(ctx context.Context) error {
	center, err := s.q.CreateMathCenter(ctx, int32(DemoGraduationYear))
	if err != nil {
		return fmt.Errorf("seed: create center: %w", err)
	}
	s.centerID = center.ID

	groups := make([]int64, 0, demoGroups)
	for i := range demoGroups {
		g, err := s.q.CreateMathCenterGroup(ctx, store.CreateMathCenterGroupParams{
			MathCenterID: center.ID,
			Name:         fmt.Sprintf("Демо-группа %c", rune('А'+i)),
		})
		if err != nil {
			return fmt.Errorf("seed: create group: %w", err)
		}
		groups = append(groups, g.ID)
	}
	s.res.Groups = len(groups)

	if err := s.createTeachers(ctx); err != nil {
		return err
	}
	if err := s.createStudents(ctx, groups); err != nil {
		return err
	}
	if err := s.createSeries(ctx); err != nil {
		return err
	}
	return s.seedSubmissions(ctx)
}

func (s *seeder) createTeachers(ctx context.Context) error {
	head, err := s.createUser(ctx, demoUsernamePrefix+"teacher-head", "Глава", "Преподаватель")
	if err != nil {
		return err
	}
	if _, err := s.q.AddTeacherToCenter(ctx, store.AddTeacherToCenterParams{
		UserID: head.ID, MathCenterID: s.centerID, IsHeadTeacher: true,
	}); err != nil {
		return fmt.Errorf("seed: add head teacher: %w", err)
	}
	s.addLogin(head, "старший преподаватель")

	teacher, err := s.createUser(ctx, demoUsernamePrefix+"teacher", "Обычный", "Преподаватель")
	if err != nil {
		return err
	}
	if _, err := s.q.AddTeacherToCenter(ctx, store.AddTeacherToCenterParams{
		UserID: teacher.ID, MathCenterID: s.centerID, IsHeadTeacher: false,
	}); err != nil {
		return fmt.Errorf("seed: add teacher: %w", err)
	}
	s.addLogin(teacher, "преподаватель")
	s.teacherID = teacher.ID
	s.res.Teachers = 2
	return nil
}

func (s *seeder) createStudents(ctx context.Context, groups []int64) error {
	for i := range demoStudents {
		u, err := s.createUser(ctx,
			fmt.Sprintf("%sstudent-%d", demoUsernamePrefix, i+1),
			fmt.Sprintf("Студент %d", i+1), "Демо")
		if err != nil {
			return err
		}
		if _, err := s.q.AddStudentToGroup(ctx, store.AddStudentToGroupParams{
			UserID: u.ID, GroupID: groups[i%len(groups)],
		}); err != nil {
			return fmt.Errorf("seed: enrol student: %w", err)
		}
		s.studentIDs = append(s.studentIDs, u.ID)
		s.addLogin(u, "ученик")
	}
	s.res.Students = demoStudents
	return nil
}

// seriesSpecs defines the demo series: a name and, per problem, its subpart
// count (0 = a single unlabelled part).
var seriesSpecs = []struct {
	name     string
	subparts []int
}{
	{"Вводная серия", []int{0, 2, 3}},
	{"Основная серия", []int{2, 0}},
}

func (s *seeder) createSeries(ctx context.Context) error {
	for i, spec := range seriesSpecs {
		series, err := s.q.CreateSeries(ctx, store.CreateSeriesParams{
			MathCenterID: s.centerID,
			Number:       int32(i + 1),
			Name:         spec.name,
			// Stagger due dates so the demo shows both open and tight series.
			DueAt: time.Now().Add(time.Duration(7*(i+1)) * 24 * time.Hour),
		})
		if err != nil {
			return fmt.Errorf("seed: create series: %w", err)
		}
		for pi, count := range spec.subparts {
			problem, err := s.q.CreateProblem(ctx, store.CreateProblemParams{
				SeriesID: series.ID, Number: int32(pi + 1),
			})
			if err != nil {
				return fmt.Errorf("seed: create problem: %w", err)
			}
			s.res.Problems++
			for _, label := range labelsFor(count) {
				sub, err := s.q.CreateSubproblem(ctx, store.CreateSubproblemParams{
					ProblemID: problem.ID, Label: label,
				})
				if err != nil {
					return fmt.Errorf("seed: create subproblem: %w", err)
				}
				s.subs = append(s.subs, subInfo{id: sub.ID, seriesID: series.ID})
				s.res.Subproblems++
			}
		}
		// Publish so students see it (the rollup hides drafts) and give it a
		// minimal statement so the "Условие" tab renders.
		tex := fmt.Sprintf(
			`\documentclass{article}\begin{document}\section*{%s}Демонстрационное условие. Решите задачи 1–%d.\end{document}`,
			spec.name, len(spec.subparts))
		if _, err := s.db.Exec(ctx,
			`UPDATE math_center_series SET published_at = NOW(), tex_source = $1 WHERE id = $2`,
			tex, series.ID); err != nil {
			return fmt.Errorf("seed: publish series: %w", err)
		}
	}
	s.res.Series = len(seriesSpecs)
	return nil
}

// seedSubmissions walks every (student, subproblem) pair and seeds a homework
// thread in a deterministic status from stateCycle (untouched pairs get none).
func (s *seeder) seedSubmissions(ctx context.Context) error {
	for si, studentID := range s.studentIDs {
		for gi, sub := range s.subs {
			state := stateCycle[(si+gi)%len(stateCycle)]
			if err := s.seedSubmission(ctx, state, studentID, sub); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *seeder) seedSubmission(ctx context.Context, state subState, studentID int64, sub subInfo) error {
	if state == stUntouched {
		return nil
	}
	thread, err := s.q.FindOrCreateThread(ctx, store.FindOrCreateThreadParams{
		StudentUserID: studentID, SubproblemID: sub.id, SeriesID: sub.seriesID, MathCenterID: s.centerID,
	})
	if err != nil {
		return fmt.Errorf("seed: thread: %w", err)
	}
	submit, err := s.append(ctx, thread.ID, hw.KindSubmitted, studentID, "Демо-решение задачи.", nil)
	if err != nil {
		return err
	}
	if err := s.q.UpdateThreadAfterSubmit(ctx, store.UpdateThreadAfterSubmitParams{
		ID: thread.ID, CurrentAttemptEventID: &submit.ID,
	}); err != nil {
		return fmt.Errorf("seed: after submit: %w", err)
	}
	s.res.Submissions++

	switch state {
	case stSubmitted:
		return nil
	case stUnderReview:
		// Claim without grading: the thread reads as "На проверке".
		if _, err := s.q.TryClaim(ctx, store.TryClaimParams{GraderUserID: s.teacherID, ID: thread.ID}); err != nil {
			return fmt.Errorf("seed: claim: %w", err)
		}
		return nil
	case stAccepted:
		return s.grade(ctx, thread.ID, hw.VerdictAccepted)
	case stRejected:
		return s.grade(ctx, thread.ID, hw.VerdictRejected)
	case stAppealed:
		if err := s.grade(ctx, thread.ID, hw.VerdictRejected); err != nil {
			return err
		}
		appeal, err := s.append(ctx, thread.ID, hw.KindAppealed, studentID, "Прошу пересмотреть решение.", nil)
		if err != nil {
			return err
		}
		return s.q.UpdateThreadAfterAppeal(ctx, store.UpdateThreadAfterAppealParams{
			ID: thread.ID, CurrentAttemptEventID: &appeal.ID,
		})
	default:
		return nil
	}
}

// grade claims the thread (required by UpdateThreadAfterGrade's guard), appends
// a graded event, then applies the verdict.
func (s *seeder) grade(ctx context.Context, threadID int64, verdict string) error {
	if _, err := s.q.TryClaim(ctx, store.TryClaimParams{GraderUserID: s.teacherID, ID: threadID}); err != nil {
		return fmt.Errorf("seed: claim for grade: %w", err)
	}
	body := "Принято, отличная работа."
	if verdict == hw.VerdictRejected {
		body = "Есть недочёты, посмотрите ещё раз."
	}
	v := verdict
	graded, err := s.append(ctx, threadID, hw.KindGraded, s.teacherID, body, &v)
	if err != nil {
		return err
	}
	n, err := s.q.UpdateThreadAfterGrade(ctx, store.UpdateThreadAfterGradeParams{
		Verdict: verdict, GradeEventID: graded.ID, GraderUserID: s.teacherID, ID: threadID,
	})
	if err != nil {
		return fmt.Errorf("seed: after grade: %w", err)
	}
	if n != 1 {
		return fmt.Errorf("seed: grade affected %d rows, want 1", n)
	}
	return nil
}

func (s *seeder) append(ctx context.Context, threadID int64, kind string, actorID int64, body string, verdict *string) (store.HomeworkThreadEvent, error) {
	uuid, err := newEventUUID()
	if err != nil {
		return store.HomeworkThreadEvent{}, err
	}
	ev, err := s.q.AppendEvent(ctx, store.AppendEventParams{
		ThreadID: threadID, EventUuid: uuid, Kind: kind, ActorUserID: actorID, Body: body, Verdict: verdict,
	})
	if err != nil {
		return store.HomeworkThreadEvent{}, fmt.Errorf("seed: append %s event: %w", kind, err)
	}
	return ev, nil
}

func (s *seeder) createUser(ctx context.Context, username, first, last string) (store.User, error) {
	u, err := s.q.CreateUser(ctx, store.CreateUserParams{
		Username: username, PasswordHash: s.pwHash, FirstName: first, LastName: last,
	})
	if err != nil {
		return store.User{}, fmt.Errorf("seed: create user %s: %w", username, err)
	}
	return u, nil
}

func (s *seeder) addLogin(u store.User, role string) {
	s.res.Logins = append(s.res.Logins, Login{
		Username: u.Username,
		Role:     role,
		Name:     fmt.Sprintf("%s %s", u.FirstName, u.LastName),
	})
}

// labelsFor maps a subpart count to subproblem labels, mirroring the series
// handler: 0 → a single unlabelled part (sentinel ""), N → a, b, … .
func labelsFor(count int) []string {
	labels := mc.SubproblemLabels(count)
	if len(labels) == 0 {
		return []string{""}
	}
	return labels
}

func newEventUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("seed: uuid: %w", err)
	}
	return "seed-" + hex.EncodeToString(b), nil
}
