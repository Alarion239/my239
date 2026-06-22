// Package seed generates a self-contained demo dataset (a math center with
// groups, teachers, students, published series, and homework submissions spread
// across every status) so the app can be exercised end-to-end without manual
// setup. It is admin-triggered (see handlers/admin) and resets itself: each run
// deletes the previous demo data before recreating a fresh, deterministic set.
//
// "Demo data" is anything under the sentinel graduation year DemoGraduationYear
// plus any non-admin user whose username starts with "demo-". Nothing else is
// touched.
//
// Problems get harder later in each series (fewer students solve them); any
// subproblem solved by fewer than coffinThreshold students is marked a coffin.
package seed

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
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

	demoGroups           = 3
	demoStudentsPerGroup = 30
	demoStudents         = demoGroups * demoStudentsPerGroup // 90
	demoHeadTeachers     = 2
	demoRegularTeachers  = 10

	// coffinThreshold: a subproblem solved (accepted) by fewer than this many
	// students is left as a coffin.
	coffinThreshold = 5
	// activeNonSolverCap bounds how many non-solving students get visible
	// activity (rejected / in-queue / under-review / appealed) per subproblem;
	// the rest leave the subproblem untouched.
	activeNonSolverCap = 12
	// studentLoginsShown caps how many student logins the result lists (they all
	// follow the demo-student-N pattern with the shared password).
	studentLoginsShown = 6

	// Difficulty gradient: a subproblem's expected solve rate falls with its
	// problem's position in the series and, slightly, with its subpart index.
	rateMax        = 0.85
	ratePerProblem = 0.16
	ratePerSubpart = 0.07
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
	Coffins        int     `json:"coffins"`
	Submissions    int     `json:"submissions"`
	StudentCount   int     `json:"student_count"` // total students (logins list is capped)
	Password       string  `json:"password"`
	Logins         []Login `json:"logins"`
}

// subState is the homework status to seed for one (student, subproblem) pair.
type subState int

const (
	stSubmitted subState = iota
	stUnderReview
	stRejected
	stAppealed
	stAccepted
)

// activeStates is cycled across the non-solving students that get visible
// activity on a subproblem (accepted students are handled separately).
var activeStates = []subState{stRejected, stSubmitted, stUnderReview, stAppealed}

// subInfo is a created subproblem plus the series it belongs to and how many
// students should solve (accept) it.
type subInfo struct {
	id             int64
	seriesID       int64
	acceptedTarget int
}

// seeder carries the per-run state. The transaction is supplied via db (used
// both for the generated store and for the few raw maintenance statements).
type seeder struct {
	db         store.DBTX
	q          *store.Queries
	pwHash     string
	now        time.Time
	centerID   int64
	graderIDs  []int64 // regular teachers, used round-robin as graders
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
		now:    time.Now(),
		res: Result{
			GraduationYear: DemoGraduationYear,
			Password:       DemoPassword,
			StudentCount:   demoStudents,
		},
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
	for i := range demoHeadTeachers {
		u, err := s.createUser(ctx,
			fmt.Sprintf("%shead-%d", demoUsernamePrefix, i+1),
			fmt.Sprintf("Старший %d", i+1), "Преподаватель")
		if err != nil {
			return err
		}
		if _, err := s.q.AddTeacherToCenter(ctx, store.AddTeacherToCenterParams{
			UserID: u.ID, MathCenterID: s.centerID, IsHeadTeacher: true,
		}); err != nil {
			return fmt.Errorf("seed: add head teacher: %w", err)
		}
		s.addLogin(u, "старший преподаватель")
	}
	for i := range demoRegularTeachers {
		u, err := s.createUser(ctx,
			fmt.Sprintf("%steacher-%d", demoUsernamePrefix, i+1),
			fmt.Sprintf("Преподаватель %d", i+1), "Демо")
		if err != nil {
			return err
		}
		if _, err := s.q.AddTeacherToCenter(ctx, store.AddTeacherToCenterParams{
			UserID: u.ID, MathCenterID: s.centerID, IsHeadTeacher: false,
		}); err != nil {
			return fmt.Errorf("seed: add teacher: %w", err)
		}
		s.graderIDs = append(s.graderIDs, u.ID)
		s.addLogin(u, "преподаватель")
	}
	s.res.Teachers = demoHeadTeachers + demoRegularTeachers
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
			UserID: u.ID, GroupID: groups[i/demoStudentsPerGroup],
		}); err != nil {
			return fmt.Errorf("seed: enrol student: %w", err)
		}
		s.studentIDs = append(s.studentIDs, u.ID)
		if i < studentLoginsShown {
			s.addLogin(u, "ученик")
		}
	}
	s.res.Students = demoStudents
	return nil
}

// seriesSpecs defines the demo series: a name and, per problem, its subpart
// count (0 = a single unlabelled part). Problems are ordered easy → hard.
var seriesSpecs = []struct {
	name     string
	subparts []int
}{
	{"Вводная серия", []int{0, 0, 2, 1, 3, 2, 3}},
	{"Основная серия", []int{0, 2, 1, 3, 2, 3}},
}

func (s *seeder) createSeries(ctx context.Context) error {
	for i, spec := range seriesSpecs {
		series, err := s.q.CreateSeries(ctx, store.CreateSeriesParams{
			MathCenterID: s.centerID,
			Number:       int32(i + 1),
			Name:         spec.name,
			// Stagger due dates so the demo shows both open and tight series.
			DueAt: s.now.Add(time.Duration(7*(i+1)) * 24 * time.Hour),
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
			for spi, label := range labelsFor(count) {
				sub, err := s.q.CreateSubproblem(ctx, store.CreateSubproblemParams{
					ProblemID: problem.ID, Label: label,
				})
				if err != nil {
					return fmt.Errorf("seed: create subproblem: %w", err)
				}
				s.subs = append(s.subs, subInfo{
					id: sub.ID, seriesID: series.ID, acceptedTarget: acceptedTarget(pi, spi),
				})
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

// acceptedTarget is how many of the cohort solve a subproblem at the given
// problem index (0-based, within its series) and subpart index. Later problems
// and later subparts are harder, so fewer students solve them.
func acceptedTarget(problemIdx, subpartIdx int) int {
	rate := rateMax - float64(problemIdx)*ratePerProblem - float64(subpartIdx)*ratePerSubpart
	if rate < 0 {
		rate = 0
	}
	if rate > 1 {
		rate = 1
	}
	return int(math.Round(rate * float64(demoStudents)))
}

// seedSubmissions assigns each subproblem `acceptedTarget` solvers plus a
// bounded band of active non-solvers, leaving the rest untouched. Solver windows
// rotate across the cohort so students vary. Sub-threshold subproblems become
// coffins.
func (s *seeder) seedSubmissions(ctx context.Context) error {
	graderCursor := 0
	for k, sub := range s.subs {
		start := (k * 7) % demoStudents
		active := activeNonSolverCap
		if rem := demoStudents - sub.acceptedTarget; active > rem {
			active = rem
		}

		for n := range sub.acceptedTarget {
			studentID := s.studentIDs[(start+n)%demoStudents]
			if err := s.seedSubmission(ctx, stAccepted, studentID, s.nextGrader(&graderCursor), sub); err != nil {
				return err
			}
		}
		for n := range active {
			studentID := s.studentIDs[(start+sub.acceptedTarget+n)%demoStudents]
			state := activeStates[n%len(activeStates)]
			if err := s.seedSubmission(ctx, state, studentID, s.nextGrader(&graderCursor), sub); err != nil {
				return err
			}
		}

		if sub.acceptedTarget < coffinThreshold {
			if _, err := s.q.UpsertCoffinFlag(ctx, store.UpsertCoffinFlagParams{
				SubproblemID: sub.id, IsCoffin: true,
			}); err != nil {
				return fmt.Errorf("seed: mark coffin: %w", err)
			}
			s.res.Coffins++
		}
	}
	return nil
}

func (s *seeder) nextGrader(cursor *int) int64 {
	id := s.graderIDs[*cursor%len(s.graderIDs)]
	*cursor++
	return id
}

// finalState is the denormalized thread state written in one UPDATE after the
// events are appended — cheaper than the per-action store mutations.
type finalState struct {
	status       string
	attemptID    *int64
	gradeID      *int64
	graderID     *int64
	claimHolder  *int64
	claimExpires *time.Time
}

func (s *seeder) seedSubmission(ctx context.Context, state subState, studentID, graderID int64, sub subInfo) error {
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

	f := finalState{status: hw.StatusSubmitted, attemptID: &submit.ID}
	switch state {
	case stSubmitted:
		// In the grading queue, awaiting a grader.
	case stUnderReview:
		exp := s.now.Add(15 * time.Minute)
		f.claimHolder, f.claimExpires = &graderID, &exp
	case stRejected:
		grade, err := s.appendGrade(ctx, thread.ID, graderID, hw.VerdictRejected)
		if err != nil {
			return err
		}
		f.status, f.gradeID, f.graderID = hw.StatusRejected, &grade.ID, &graderID
	case stAppealed:
		grade, err := s.appendGrade(ctx, thread.ID, graderID, hw.VerdictRejected)
		if err != nil {
			return err
		}
		appeal, err := s.append(ctx, thread.ID, hw.KindAppealed, studentID, "Прошу пересмотреть решение.", nil)
		if err != nil {
			return err
		}
		f.status, f.gradeID, f.graderID, f.attemptID = hw.StatusAppealed, &grade.ID, &graderID, &appeal.ID
	case stAccepted:
		grade, err := s.appendGrade(ctx, thread.ID, graderID, hw.VerdictAccepted)
		if err != nil {
			return err
		}
		f.status, f.gradeID, f.graderID = hw.StatusAccepted, &grade.ID, &graderID
	}

	if err := s.finalize(ctx, thread.ID, f); err != nil {
		return err
	}
	s.res.Submissions++
	return nil
}

// finalize writes the thread's denormalized columns directly. Equivalent to the
// app's UpdateThreadAfter* / TryClaim mutations but in a single statement.
func (s *seeder) finalize(ctx context.Context, threadID int64, f finalState) error {
	_, err := s.db.Exec(ctx,
		`UPDATE homework_thread
		    SET current_status           = $1,
		        current_attempt_event_id = $2,
		        current_grade_event_id   = $3,
		        last_grader_user_id      = $4,
		        claim_holder_user_id     = $5,
		        claim_expires_at         = $6,
		        updated_at               = NOW()
		  WHERE id = $7`,
		f.status, f.attemptID, f.gradeID, f.graderID, f.claimHolder, f.claimExpires, threadID)
	if err != nil {
		return fmt.Errorf("seed: finalize thread: %w", err)
	}
	return nil
}

func (s *seeder) appendGrade(ctx context.Context, threadID, graderID int64, verdict string) (store.HomeworkThreadEvent, error) {
	body := "Принято, отличная работа."
	if verdict == hw.VerdictRejected {
		body = "Есть недочёты, посмотрите ещё раз."
	}
	v := verdict
	return s.append(ctx, threadID, hw.KindGraded, graderID, body, &v)
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
