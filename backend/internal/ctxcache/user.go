// Package ctxcache memoizes per-request lookups for the authenticated user.
//
// AuthMiddleware puts the user_id into the request context. Several handlers
// then need the full user row. ctxcache caches it on the context so two
// handlers in the same chain don't both hit the DB.
package ctxcache

import (
	"context"
	"errors"

	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

var ErrNoUserIDFound = errors.New("no user ID found")

// User returns the cached user from the request context, if any.
func User(ctx context.Context) (*store.User, bool) {
	user, ok := ctx.Value(config.CtxKeyUser).(*store.User)
	return user, ok
}

// UserID returns the authenticated user's ID from the request context.
func UserID(ctx context.Context) (int64, error) {
	userID, ok := ctx.Value(config.CtxKeyUserID).(int64)
	if !ok {
		return 0, ErrNoUserIDFound
	}
	return userID, nil
}

// EnsureUser returns the user for the current request, loading it from the
// database on cache miss and caching it on the returned context.
func EnsureUser(database *db.DB, ctx context.Context) (context.Context, *store.User, error) {
	if user, ok := User(ctx); ok {
		return ctx, user, nil
	}

	userID, err := UserID(ctx)
	if err != nil {
		return ctx, nil, err
	}

	user, err := store.New(database.Pool()).GetUserByID(ctx, userID)
	if err != nil {
		return ctx, nil, err
	}

	ctx = context.WithValue(ctx, config.CtxKeyUser, &user)
	return ctx, &user, nil
}
