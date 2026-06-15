// Package admin contains the /api/v1/admin endpoints. All routes mounted
// here are gated by middleware.AuthMiddleware + middleware.AdminMiddleware,
// so handlers may assume r.Context() carries an authenticated admin user.
package admin

import (
	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/go-chi/chi/v5"
)

// Router wires up admin endpoints. Mount at /api/v1/admin in the main router.
func Router(database *db.DB, tokens *internalAuth.TokenService) chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.AuthMiddleware(tokens.Access()))
	r.Use(middleware.AdminMiddleware)

	r.Get("/users", ListUsers(database))
	r.Patch("/users/{id}/admin", SetUserAdmin(database))

	r.Get("/tokens", ListTokens(database))
	r.Post("/tokens", CreateToken(database))
	r.Delete("/tokens/{id}", RevokeToken(database))

	r.Route("/mathcenter", func(r chi.Router) {
		r.Get("/", ListMathCenters(database))
		r.Post("/", CreateMathCenter(database))
		r.Delete("/{id}", DeleteMathCenter(database))

		r.Get("/{id}/groups", ListGroupsForCenter(database))
		r.Post("/{id}/groups", CreateGroup(database))
		r.Delete("/{id}/groups/{groupId}", DeleteGroup(database))

		r.Get("/{id}/students", ListStudentsForCenter(database))
		r.Post("/students", AddStudent(database))
		r.Delete("/students/{studentId}", RemoveStudent(database))

		r.Get("/{id}/teachers", ListTeachersForCenter(database))
		r.Post("/{id}/teachers", AddTeacher(database))
		r.Patch("/teachers/{teacherId}/head", SetTeacherHead(database))
		r.Delete("/teachers/{teacherId}", RemoveTeacher(database))

		// Shared "MathCenter" classroom login, provisioned as a head teacher
		// of {id}. See CreateMathCenterAccount.
		r.Post("/{id}/accounts", CreateMathCenterAccount(database))
	})

	return r
}
