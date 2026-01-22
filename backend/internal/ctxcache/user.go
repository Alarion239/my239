package ctxcache

import (
	"context"
	"errors"

	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/Alarion239/my239/backend/models/common"
	"github.com/Alarion239/my239/backend/pkg/db"
)

var ErrNoUserIDFound = errors.New("no user ID found")

func User(ctx context.Context) (*common.User, bool) {
	user, ok := ctx.Value(config.CtxKeyUser).(*common.User)
	return user, ok
}

func UserID(ctx context.Context) (int64, error) {
	userID, ok := ctx.Value(config.CtxKeyUserID).(int64)
	if !ok {
		return 0, ErrNoUserIDFound
	}
	return userID, nil
}

func EnsureUser(db *db.DB, ctx context.Context) (context.Context, *common.User, error) {
	user, ok := User(ctx)
	if !ok {
		userID, err := UserID(ctx)
		if err != nil {
			return ctx, nil, ErrNoUserIDFound
		}
		user, err := common.NewUserRepo(db).GetByID(ctx, userID)
		if err != nil {
			return ctx, nil, err
		}
		ctx = context.WithValue(ctx, config.CtxKeyUser, user)
	}
	return ctx, user, nil
}
