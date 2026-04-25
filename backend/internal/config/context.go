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
)
