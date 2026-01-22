package authorization

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/jackc/pgx/v5"
)

type InvitationToken struct {
	ID          int64     `json:"id" db:"id"`
	Token       string    `json:"token" db:"token"`
	Description string    `json:"description" db:"description"`
	MaxUses     int       `json:"max_uses" db:"max_uses"`
	ExpiresAt   time.Time `json:"expires_at" db:"expires_at"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

type InvitationTokenRepo struct {
	db *db.DB
}

func NewInvitationTokenRepo(db *db.DB) *InvitationTokenRepo {
	return &InvitationTokenRepo{db: db}
}

var ErrTokenNotFound = errors.New("token not found")

func (repo *InvitationTokenRepo) GetByToken(ctx context.Context, token string) (*InvitationToken, error) {
	var it InvitationToken
	err := repo.db.Pool().QueryRow(ctx, `
		SELECT id, description, token, max_uses, expires_at, created_at
		FROM authorization.invitation_tokens
		WHERE token = $1
	`, token).Scan(
		&it.ID,
		&it.Description,
		&it.Token,
		&it.MaxUses,
		&it.ExpiresAt,
		&it.CreatedAt,
	)

	if err == nil {
		return &it, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrTokenNotFound
	}

	// Do not include the raw token value in the error string to avoid leaking secrets into logs.
	return nil, fmt.Errorf("GetByToken: %w", err)
}

func (repo *InvitationTokenRepo) CountUsesOfToken(ctx context.Context, tokenID int64) (int, error) {
	var count int
	err := repo.db.Pool().QueryRow(ctx, `
		SELECT COUNT(*)
		FROM common.users
		WHERE invitation_token_id = $1
	`, tokenID).Scan(&count)

	if err == nil {
		return count, nil
	}
	return 0, fmt.Errorf("CountUsesOfToken(%d): %w", tokenID, err)
}

func (repo *InvitationTokenRepo) Create(ctx context.Context, token *InvitationToken) (int64, error) {
	var id int64
	err := repo.db.Pool().QueryRow(ctx, `
		INSERT INTO authorization.invitation_tokens
			(token, max_uses, description, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, token.Token, token.MaxUses, token.Description, token.ExpiresAt, token.CreatedAt).Scan(&id)

	if err != nil {
		return 0, fmt.Errorf("Create: %w", err)
	}
	return id, nil
}

func (repo *InvitationTokenRepo) ListAll(ctx context.Context) ([]*InvitationToken, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		SELECT id, token, description, max_uses, expires_at, created_at
		FROM authorization.invitation_tokens
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("ListAll: %w", err)
	}
	defer rows.Close()

	var tokens []*InvitationToken
	for rows.Next() {
		var token InvitationToken
		err := rows.Scan(
			&token.ID,
			&token.Token,
			&token.Description,
			&token.MaxUses,
			&token.ExpiresAt,
			&token.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("ListAll: scan error: %w", err)
		}
		tokens = append(tokens, &token)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("ListAll: iteration error: %w", err)
	}

	return tokens, nil
}

func (repo *InvitationTokenRepo) Revoke(ctx context.Context, token string) error {
	result, err := repo.db.Pool().Exec(ctx, `
		UPDATE authorization.invitation_tokens
		SET expires_at = NOW()
		WHERE token = $1
	`, token)
	if err != nil {
		return fmt.Errorf("Revoke: %w", err)
	}

	if result.RowsAffected() == 0 {
		return ErrTokenNotFound
	}

	return nil
}

func (repo *InvitationTokenRepo) RevokeByID(ctx context.Context, tokenID int64) error {
	result, err := repo.db.Pool().Exec(ctx, `
		UPDATE authorization.invitation_tokens
		SET expires_at = NOW()
		WHERE id = $1
	`, tokenID)
	if err != nil {
		return fmt.Errorf("RevokeByID: %w", err)
	}

	if result.RowsAffected() == 0 {
		return ErrTokenNotFound
	}

	return nil
}
