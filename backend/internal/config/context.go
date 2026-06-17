package config

type ctxKey int

const (
	// CtxKeyUser holds a *store.User cached on the request context by
	// ctxcache.EnsureUser. Use ctxcache.User(ctx) to read it.
	CtxKeyUser ctxKey = iota

	// CtxKeyUserID holds the authenticated user's int64 ID as set by
	// AuthMiddleware. Used by every handler that needs to know "who is
	// this request from".
	CtxKeyUserID

	// CtxKeyIsAdmin holds the authenticated user's bool admin status as
	// claimed by their JWT. AdminMiddleware reads this to gate /admin/*
	// routes without an extra DB hit on every request.
	CtxKeyIsAdmin

	// CtxKeyRealUserID holds the int64 ID of the REAL caller during act-as
	// impersonation. ImpersonationMiddleware sets it (alongside overwriting
	// CtxKeyUserID with the target's ID) so the audit trail can tell who is
	// actually behind a request. Absent when no impersonation is active.
	CtxKeyRealUserID

	// CtxKeyRealIsAdmin holds the REAL caller's bool admin status during
	// act-as impersonation. Set by ImpersonationMiddleware so downstream
	// code (or future tooling) can distinguish "is this an admin acting as
	// someone" from the now-overwritten effective CtxKeyIsAdmin.
	CtxKeyRealIsAdmin
)
