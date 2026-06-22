// Package seed generates a self-contained demo dataset (a math center with
// groups, teachers, students, series, and homework submissions spread across
// every status) so the app can be exercised end-to-end without manual setup. It
// is admin-triggered (see handlers/admin) and resets itself: each run deletes
// the previous demo data before recreating a fresh set.
//
// "Demo data" is anything under the sentinel graduation year DemoGraduationYear
// plus any non-admin user whose username starts with "demo-". Nothing else is
// touched.
//
// The 5 series form a realistic timeline: the first 3 are in the past, fully
// graded, with разбор (solutions) posted (though some coffins are left open);
// the 4th is the current one (open, actively being graded — in-queue /
// under-review statuses appear here); the 5th is prepared for the future
// (published, no submissions yet). Submissions and gradings carry spread-out
// timestamps. Each run is randomized: students have a latent ability and
// subproblems a difficulty (harder later, 6-8 problems per series), so the
// solve grid has real spread, different teachers grade different work, and any
// subproblem solved by fewer than coffinThreshold students becomes a coffin.
package seed

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	mrand "math/rand/v2"
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

	// Timeline: of the 5 series, the first pastSeriesCount are finished, the next
	// is the current/open one, and the rest are prepared for the future.
	pastSeriesCount = 3

	// openPastCoffinChance: fraction of a past series' coffins left OPEN (разбор
	// not yet posted, still accepting submissions) instead of released/closed.
	openPastCoffinChance = 0.5

	// Day spans shaping the timeline.
	seriesSpacingDays    = 14 // gap between consecutive past series' deadlines
	recentPastGapDays    = 5  // how long ago the most recent past series closed
	submissionWindowDays = 10 // open → due
	gradingWindowDays    = 4  // due → last grade posted (past series)
	currentOpenDaysAgo   = 5  // the current series opened this many days ago
	currentDueInDays     = 5  // the current series is due this many days from now
	futureOpenInDays     = 9  // the future series opens this many days from now

	// coffinThreshold: a subproblem solved (accepted) by fewer than this many
	// students is left as a coffin.
	coffinThreshold = 5
	// studentLoginsShown caps how many student logins the result lists (they all
	// follow the demo-student-N pattern with the shared password).
	studentLoginsShown = 6

	// Difficulty model (solve probability, before clamping). A subproblem's base
	// solve rate falls with its problem's position and subpart index; the last
	// problem of each series gets an extra "finale" penalty (the brutal one).
	// Per-student ability shifts the rate; per-subproblem jitter adds spread.
	baseSolveRate    = 0.90
	dropPerProblem   = 0.13
	dropPerSubpart   = 0.08
	finalePenalty    = 0.40
	difficultyJitter = 0.08
	abilityMin       = -0.30
	abilityMax       = 0.35
	maxSolveProb     = 0.98
	// attemptRate: chance a non-solving student still has visible activity rather
	// than leaving the subproblem untouched.
	attemptRate = 0.30

	demoRazborTex = `\documentclass{article}\begin{document}\section*{Разбор}` +
		`Ключевая идея и аккуратное решение задачи приведены ниже.\end{document}`
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
	OpenCoffins    int     `json:"open_coffins"` // coffins still open (разбор not released)
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

// seriesPhase places a series on the timeline.
type seriesPhase int

const (
	phasePast    seriesPhase = iota // finished, graded, разбор posted
	phaseCurrent                    // open, actively being graded
	phaseFuture                     // prepared, not yet opened (no submissions)
)

// seriesTiming holds the time anchors for one series.
type seriesTiming struct {
	phase       seriesPhase
	openedAt    time.Time // students could start submitting
	dueAt       time.Time
	submitClose time.Time // last moment a demo submission is dated (due, or now)
	gradeCap    time.Time // last moment a demo grade is dated
}

// subInfo is a created subproblem plus its series and base solve rate.
type subInfo struct {
	id        int64
	seriesID  int64
	seriesIdx int
	solveBase float64
}

// seeder carries the per-run state. The transaction is supplied via db (used
// both for the generated store and for the raw maintenance/timestamp queries).
type seeder struct {
	db         store.DBTX
	q          *store.Queries
	pwHash     string
	now        time.Time
	centerID   int64
	graderIDs  []int64        // regular teachers, used as graders
	studentIDs []int64        // seeded students, in creation order
	timings    []seriesTiming // per series, by index
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
		u, err := s.createUser(ctx, fmt.Sprintf("%shead-%d", demoUsernamePrefix, i+1))
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
		u, err := s.createUser(ctx, fmt.Sprintf("%steacher-%d", demoUsernamePrefix, i+1))
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
		u, err := s.createUser(ctx, fmt.Sprintf("%sstudent-%d", demoUsernamePrefix, i+1))
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

// seriesSpecs defines the 10 demo series: a name and, per problem, its subpart
// count (0 = a single unlabelled part). Problems are ordered easy → hard.
var seriesSpecs = []struct {
	name     string
	subparts []int
}{
	{"Алгебра и многочлены", []int{0, 0, 0, 1, 2, 2, 3}},     // 7 problems, 11 subproblems
	{"Планиметрия", []int{0, 0, 0, 0, 1, 2, 0, 3}},           // 8 problems, 11 subproblems
	{"Теория чисел", []int{0, 0, 1, 2, 0, 3}},                // 6 problems, 9 subproblems
	{"Комбинаторика и графы", []int{0, 0, 0, 1, 2, 0, 3}},    // 7 problems, 10 subproblems
	{"Неравенства и функции", []int{0, 0, 0, 1, 0, 2, 2, 3}}, // 8 problems, 12 subproblems
}

// timingFor places series i on the timeline.
func (s *seeder) timingFor(i int) seriesTiming {
	switch {
	case i < pastSeriesCount:
		// Most recent past series closed recentPastGapDays ago; earlier ones step
		// back seriesSpacingDays each.
		due := s.now.AddDate(0, 0, -(recentPastGapDays + (pastSeriesCount-1-i)*seriesSpacingDays))
		opened := due.AddDate(0, 0, -submissionWindowDays)
		return seriesTiming{
			phase: phasePast, openedAt: opened, dueAt: due,
			submitClose: due, gradeCap: due.AddDate(0, 0, gradingWindowDays),
		}
	case i == pastSeriesCount:
		return seriesTiming{
			phase:    phaseCurrent,
			openedAt: s.now.AddDate(0, 0, -currentOpenDaysAgo),
			dueAt:    s.now.AddDate(0, 0, currentDueInDays),
			// Demo "now" caps live submissions/grades for the open series.
			submitClose: s.now, gradeCap: s.now,
		}
	default:
		opened := s.now.AddDate(0, 0, futureOpenInDays)
		return seriesTiming{
			phase: phaseFuture, openedAt: opened, dueAt: opened.AddDate(0, 0, submissionWindowDays),
		}
	}
}

func (s *seeder) createSeries(ctx context.Context) error {
	for i, spec := range seriesSpecs {
		t := s.timingFor(i)
		s.timings = append(s.timings, t)

		series, err := s.q.CreateSeries(ctx, store.CreateSeriesParams{
			MathCenterID: s.centerID,
			Number:       int32(i + 1),
			Name:         spec.name,
			DueAt:        t.dueAt,
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
				base := solveBase(len(spec.subparts), pi, spi) +
					(mrand.Float64()*2-1)*difficultyJitter
				s.subs = append(s.subs, subInfo{
					id: sub.ID, seriesID: series.ID, seriesIdx: i, solveBase: base,
				})
				s.res.Subproblems++
			}
		}
		// Publish so students see it, give it a statement, and backdate the row
		// to match the timeline (prepared a few days before opening).
		publishedAt, createdAt := t.openedAt, t.openedAt.AddDate(0, 0, -3)
		if t.phase == phaseFuture {
			publishedAt, createdAt = s.now, s.now
		}
		tex := fmt.Sprintf(
			`\documentclass{article}\begin{document}\section*{%s}Демонстрационное условие. Решите задачи 1–%d.\end{document}`,
			spec.name, len(spec.subparts))
		if _, err := s.db.Exec(ctx,
			`UPDATE math_center_series SET published_at = $1, tex_source = $2, created_at = $3 WHERE id = $4`,
			publishedAt, tex, createdAt, series.ID); err != nil {
			return fmt.Errorf("seed: publish series: %w", err)
		}
	}
	s.res.Series = len(seriesSpecs)
	return nil
}

// solveBase is a subproblem's base solve rate (may be negative for the hardest;
// it's clamped after adding a student's ability). Later problems and later
// subparts are harder; the last problem of a series is hardest of all.
func solveBase(problemCount, problemIdx, subpartIdx int) float64 {
	rate := baseSolveRate - float64(problemIdx)*dropPerProblem - float64(subpartIdx)*dropPerSubpart
	if problemIdx == problemCount-1 {
		rate -= finalePenalty
	}
	return rate
}

// seedSubmissions assigns, per subproblem, an outcome for each student drawn
// from their ability + the subproblem's difficulty, with timestamps inside the
// series' window. Future series get no submissions; past series get terminal
// statuses + posted разбор; the current series gets the full status mix.
func (s *seeder) seedSubmissions(ctx context.Context) error {
	abilities := make([]float64, demoStudents)
	for i := range abilities {
		abilities[i] = abilityMin + mrand.Float64()*(abilityMax-abilityMin)
	}

	for _, sub := range s.subs {
		t := s.timings[sub.seriesIdx]
		if t.phase == phaseFuture {
			continue // prepared but not opened — no submissions yet
		}

		accepted := 0
		for i, studentID := range s.studentIDs {
			p := clampF(sub.solveBase+abilities[i], 0, maxSolveProb)
			submitAt := randTimeBetween(t.openedAt, t.submitClose)
			switch {
			case mrand.Float64() < p:
				if err := s.seedSubmission(ctx, stAccepted, studentID, s.randomGrader(), sub, t, submitAt); err != nil {
					return err
				}
				accepted++
			case mrand.Float64() < attemptRate:
				state := s.randomActiveState(t.phase)
				if err := s.seedSubmission(ctx, state, studentID, s.randomGrader(), sub, t, submitAt); err != nil {
					return err
				}
			}
		}

		if err := s.postSolution(ctx, sub, t, accepted < coffinThreshold); err != nil {
			return err
		}
	}
	return nil
}

// postSolution records разбор/coffin state for a subproblem. Past series get the
// разбор posted and released; the current series only flags coffins (kept open,
// разбор not yet released). isCoffin counts toward the result.
func (s *seeder) postSolution(ctx context.Context, sub subInfo, t seriesTiming, isCoffin bool) error {
	switch t.phase {
	case phasePast:
		// Keep some past coffins OPEN: their разбор isn't posted yet, so they
		// stay accepting submissions. Everything else gets разбор released.
		if isCoffin && mrand.Float64() < openPastCoffinChance {
			if err := s.upsertSolution(ctx, sub.id, true, nil, nil, t.dueAt); err != nil {
				return err
			}
			s.res.Coffins++
			s.res.OpenCoffins++
			return nil
		}
		released := randTimeBetween(t.dueAt, t.dueAt.AddDate(0, 0, gradingWindowDays))
		tex := demoRazborTex
		if err := s.upsertSolution(ctx, sub.id, isCoffin, &tex, &released, t.dueAt); err != nil {
			return err
		}
		if isCoffin {
			s.res.Coffins++
		}
	case phaseCurrent:
		if !isCoffin {
			return nil
		}
		// The current series is open — its coffins are not yet released.
		if err := s.upsertSolution(ctx, sub.id, true, nil, nil, s.now); err != nil {
			return err
		}
		s.res.Coffins++
		s.res.OpenCoffins++
	default:
		return nil
	}
	return nil
}

func (s *seeder) upsertSolution(ctx context.Context, subID int64, isCoffin bool, tex *string, releasedAt *time.Time, at time.Time) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO math_center_subproblem_solutions
		     (subproblem_id, is_coffin, solution_tex_source, released_at, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $5)
		 ON CONFLICT (subproblem_id) DO UPDATE
		     SET is_coffin = EXCLUDED.is_coffin,
		         solution_tex_source = EXCLUDED.solution_tex_source,
		         released_at = EXCLUDED.released_at,
		         updated_at = EXCLUDED.updated_at`,
		subID, isCoffin, tex, releasedAt, at)
	if err != nil {
		return fmt.Errorf("seed: upsert solution: %w", err)
	}
	return nil
}

func (s *seeder) randomGrader() int64 {
	return s.graderIDs[mrand.IntN(len(s.graderIDs))]
}

// randomActiveState picks a non-accepted status for a student who engaged with a
// subproblem but hasn't solved it. Past series are fully resolved (rejected
// only); the current series shows the live in-queue / under-review / appealed
// states too.
func (s *seeder) randomActiveState(phase seriesPhase) subState {
	if phase == phasePast {
		return stRejected
	}
	switch r := mrand.Float64(); {
	case r < 0.35:
		return stSubmitted
	case r < 0.60:
		return stRejected
	case r < 0.80:
		return stUnderReview
	default:
		return stAppealed
	}
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
	createdAt    time.Time
	updatedAt    time.Time
}

func (s *seeder) seedSubmission(ctx context.Context, state subState, studentID, graderID int64, sub subInfo, t seriesTiming, submitAt time.Time) error {
	thread, err := s.q.FindOrCreateThread(ctx, store.FindOrCreateThreadParams{
		StudentUserID: studentID, SubproblemID: sub.id, SeriesID: sub.seriesID, MathCenterID: s.centerID,
	})
	if err != nil {
		return fmt.Errorf("seed: thread: %w", err)
	}
	submitID, err := s.appendAt(ctx, thread.ID, hw.KindSubmitted, studentID, "Демо-решение задачи.", nil, submitAt)
	if err != nil {
		return err
	}

	f := finalState{status: hw.StatusSubmitted, attemptID: &submitID, createdAt: submitAt, updatedAt: submitAt}
	switch state {
	case stSubmitted:
		// In the grading queue, awaiting a grader.
	case stUnderReview:
		// Claimed recently (only the current series reaches this state).
		exp := s.now.Add(15 * time.Minute)
		f.claimHolder, f.claimExpires, f.updatedAt = &graderID, &exp, s.now
	case stRejected:
		gradeAt := randTimeBetween(submitAt.Add(time.Hour), t.gradeCap)
		gradeID, err := s.appendGrade(ctx, thread.ID, graderID, hw.VerdictRejected, gradeAt)
		if err != nil {
			return err
		}
		f.status, f.gradeID, f.graderID, f.updatedAt = hw.StatusRejected, &gradeID, &graderID, gradeAt
	case stAppealed:
		gradeAt := randTimeBetween(submitAt.Add(time.Hour), t.gradeCap)
		gradeID, err := s.appendGrade(ctx, thread.ID, graderID, hw.VerdictRejected, gradeAt)
		if err != nil {
			return err
		}
		appealAt := randTimeBetween(gradeAt.Add(time.Hour), t.gradeCap)
		appealID, err := s.appendAt(ctx, thread.ID, hw.KindAppealed, studentID, "Прошу пересмотреть решение.", nil, appealAt)
		if err != nil {
			return err
		}
		f.status, f.gradeID, f.graderID, f.attemptID, f.updatedAt = hw.StatusAppealed, &gradeID, &graderID, &appealID, appealAt
	case stAccepted:
		gradeAt := randTimeBetween(submitAt.Add(time.Hour), t.gradeCap)
		gradeID, err := s.appendGrade(ctx, thread.ID, graderID, hw.VerdictAccepted, gradeAt)
		if err != nil {
			return err
		}
		f.status, f.gradeID, f.graderID, f.updatedAt = hw.StatusAccepted, &gradeID, &graderID, gradeAt
	}

	if err := s.finalize(ctx, thread.ID, f); err != nil {
		return err
	}
	s.res.Submissions++
	return nil
}

// finalize writes the thread's denormalized columns + timestamps directly.
// Equivalent to the app's UpdateThreadAfter* / TryClaim mutations but in one
// statement, and lets the demo control created_at/updated_at.
func (s *seeder) finalize(ctx context.Context, threadID int64, f finalState) error {
	_, err := s.db.Exec(ctx,
		`UPDATE homework_thread
		    SET current_status           = $1,
		        current_attempt_event_id = $2,
		        current_grade_event_id   = $3,
		        last_grader_user_id      = $4,
		        claim_holder_user_id     = $5,
		        claim_expires_at         = $6,
		        created_at               = $7,
		        updated_at               = $8
		  WHERE id = $9`,
		f.status, f.attemptID, f.gradeID, f.graderID, f.claimHolder, f.claimExpires,
		f.createdAt, f.updatedAt, threadID)
	if err != nil {
		return fmt.Errorf("seed: finalize thread: %w", err)
	}
	return nil
}

func (s *seeder) appendGrade(ctx context.Context, threadID, graderID int64, verdict string, at time.Time) (int64, error) {
	body := "Принято, отличная работа."
	if verdict == hw.VerdictRejected {
		body = "Есть недочёты, посмотрите ещё раз."
	}
	v := verdict
	return s.appendAt(ctx, threadID, hw.KindGraded, graderID, body, &v, at)
}

// appendAt inserts a thread event with an explicit created_at and returns its
// id. (The store's AppendEvent always stamps NOW(), which would make every demo
// event share a timestamp.)
func (s *seeder) appendAt(ctx context.Context, threadID int64, kind string, actorID int64, body string, verdict *string, at time.Time) (int64, error) {
	uuid, err := newEventUUID()
	if err != nil {
		return 0, err
	}
	var id int64
	err = s.db.QueryRow(ctx,
		`INSERT INTO homework_thread_event
		     (thread_id, event_uuid, kind, actor_user_id, body, verdict, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		threadID, uuid, kind, actorID, body, verdict, at).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("seed: append %s event: %w", kind, err)
	}
	return id, nil
}

// createUser makes a demo user with the given (login) username and a random
// realistic Russian name. The username stays predictable for sign-in + teardown.
func (s *seeder) createUser(ctx context.Context, username string) (store.User, error) {
	first, last, middle := randomPerson()
	mid := middle
	u, err := s.q.CreateUser(ctx, store.CreateUserParams{
		Username: username, PasswordHash: s.pwHash, FirstName: first, LastName: last, MiddleName: &mid,
	})
	if err != nil {
		return store.User{}, fmt.Errorf("seed: create user %s: %w", username, err)
	}
	return u, nil
}

func (s *seeder) addLogin(u store.User, role string) {
	name := fmt.Sprintf("%s %s", u.FirstName, u.LastName)
	if u.MiddleName != nil {
		name = fmt.Sprintf("%s %s %s", u.LastName, u.FirstName, *u.MiddleName)
	}
	s.res.Logins = append(s.res.Logins, Login{Username: u.Username, Role: role, Name: name})
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

func clampF(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// randTimeBetween returns a uniformly random instant in [a, b], or a when b is
// not after a.
func randTimeBetween(a, b time.Time) time.Time {
	if !b.After(a) {
		return a
	}
	return a.Add(time.Duration(mrand.Float64() * float64(b.Sub(a))))
}

func newEventUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("seed: uuid: %w", err)
	}
	return "seed-" + hex.EncodeToString(b), nil
}
