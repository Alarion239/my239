package common

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/jackc/pgx/v5"
)

type User struct {
	ID                int64     `json:"id" db:"id"`
	Username          string    `json:"username" db:"username"`
	FirstName         string    `json:"first_name" db:"first_name"`
	MiddleName        *string   `json:"middle_name,omitempty" db:"middle_name"`
	LastName          string    `json:"last_name" db:"last_name"`
	InvitationTokenID int64     `json:"invitation_token_id" db:"invitation_token_id"`
	CreatedAt         time.Time `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time `json:"updated_at" db:"updated_at"`
}

type UserWithHash struct {
	User
	PasswordHash string `json:"-" db:"password_hash"`
}

type UserRepo struct {
	db *db.DB
}

func NewUserRepo(db *db.DB) *UserRepo {
	return &UserRepo{db: db}
}

var ErrUserNotFound = errors.New("user not found")

func (ur *UserRepo) GetByUsernameWithHash(ctx context.Context, username string) (*UserWithHash, error) {
	var user UserWithHash
	err := ur.db.Pool().QueryRow(ctx, `
		SELECT id, username, first_name, middle_name, last_name,
			   invitation_token_id, created_at, updated_at, password_hash
		FROM common.users
		WHERE username = $1
	`, username).Scan(
		&user.ID,
		&user.Username,
		&user.FirstName,
		&user.MiddleName,
		&user.LastName,
		&user.InvitationTokenID,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.PasswordHash,
	)
	if err == nil {
		return &user, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	return nil, fmt.Errorf("GetByUsernameWithHash(%s): %w", username, err)
}
func (ur *UserRepo) GetByID(ctx context.Context, id int64) (*User, error) {
	var user User
	err := ur.db.Pool().QueryRow(ctx, `
		SELECT id, username, first_name, middle_name, last_name,
			   invitation_token_id, created_at, updated_at
		FROM common.users
		WHERE id = $1
	`, id).Scan(
		&user.ID,
		&user.Username,
		&user.FirstName,
		&user.MiddleName,
		&user.LastName,
		&user.InvitationTokenID,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err == nil {
		return &user, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	return nil, fmt.Errorf("GetByID(%d): %w", id, err)
}

func (ur *UserRepo) Create(
	ctx context.Context,
	username string,
	firstName string,
	middleName *string,
	lastName string,
	tokenID int64,
	passwordHash string,
) (*User, error) {
	var user User

	err := ur.db.Pool().QueryRow(ctx, `
		INSERT INTO common.users (
			username,
			first_name,
			middle_name,
			last_name,
			invitation_token_id,
			password_hash,
			created_at,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
		RETURNING
			id,
			username,
			first_name,
			middle_name,
			last_name,
			invitation_token_id,
			created_at,
			updated_at
	`,
		username,
		firstName,
		middleName,
		lastName,
		tokenID,
		passwordHash,
	).Scan(
		&user.ID,
		&user.Username,
		&user.FirstName,
		&user.MiddleName,
		&user.LastName,
		&user.InvitationTokenID,
		&user.CreatedAt,
		&user.UpdatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("Create user %q: %w", username, err)
	}

	return &user, nil
}
