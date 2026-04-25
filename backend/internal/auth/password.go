// Package auth — password hashing.
//
// We use argon2id, the OWASP-recommended modern password hash. It's
// memory-hard, which makes GPU/ASIC bruteforce attacks far more expensive
// than bcrypt. The encoded format
//
//	$argon2id$v=19$m=<memory>,t=<iterations>,p=<parallelism>$<salt>$<hash>
//
// is self-describing, so we can change parameters in the future and existing
// hashes still verify against the parameters they were created with.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2idParams collects the four argon2id tuning knobs plus salt/key
// lengths. We expose this so tests can hash with cheap parameters; production
// always uses DefaultArgon2idParams.
type Argon2idParams struct {
	Memory      uint32 // KiB; OWASP-recommended 64 MiB = 65536
	Iterations  uint32 // OWASP-recommended 3
	Parallelism uint8  // 2 lanes is plenty for a web service
	SaltLength  uint32 // 16 bytes is standard
	KeyLength   uint32 // 32 bytes
}

// DefaultArgon2idParams are the production parameters. They're tuned per
// OWASP's password storage cheat sheet and yield ~50–100ms per hash on a
// modern x86 server, which is the sweet spot for online password storage.
var DefaultArgon2idParams = Argon2idParams{
	Memory:      64 * 1024,
	Iterations:  3,
	Parallelism: 2,
	SaltLength:  16,
	KeyLength:   32,
}

// MinPasswordLength matches the validator constraint at the API boundary;
// kept here so the hashing function refuses weak passwords even if a caller
// forgets to validate.
const MinPasswordLength = 8

// HashPassword returns an encoded argon2id hash suitable for storage.
func HashPassword(password string) (string, error) {
	return HashPasswordWith(password, DefaultArgon2idParams)
}

// HashPasswordWith allows the caller to pick parameters. Tests use cheap
// parameters so the suite stays fast; production calls HashPassword.
func HashPasswordWith(password string, p Argon2idParams) (string, error) {
	if len(password) < MinPasswordLength {
		return "", fmt.Errorf("password must be at least %d characters", MinPasswordLength)
	}

	salt := make([]byte, p.SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("argon2id: read salt: %w", err)
	}

	key := argon2.IDKey([]byte(password), salt, p.Iterations, p.Memory, p.Parallelism, p.KeyLength)

	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		p.Memory, p.Iterations, p.Parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// ErrPasswordMismatch is returned by CheckPassword when the password does
// not match the stored hash. Distinct from "hash is malformed" so callers
// can tell the two apart if they care.
var ErrPasswordMismatch = errors.New("password does not match")

// CheckPassword verifies a plaintext password against an encoded hash.
//
// Comparison is constant-time so timing attacks can't reveal partial
// matches. Returns ErrPasswordMismatch on mismatch and a different error if
// the encoded hash is malformed.
func CheckPassword(password, encoded string) error {
	p, salt, key, err := decodeArgon2idHash(encoded)
	if err != nil {
		return err
	}

	other := argon2.IDKey([]byte(password), salt, p.Iterations, p.Memory, p.Parallelism, p.KeyLength)
	if subtle.ConstantTimeCompare(other, key) == 1 {
		return nil
	}
	return ErrPasswordMismatch
}

func decodeArgon2idHash(encoded string) (Argon2idParams, []byte, []byte, error) {
	var p Argon2idParams
	parts := strings.Split(encoded, "$")
	// Expected: ["", "argon2id", "v=19", "m=...,t=...,p=...", "<salt>", "<hash>"] => 6 parts
	if len(parts) != 6 || parts[1] != "argon2id" {
		return p, nil, nil, errors.New("argon2id: invalid hash format")
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return p, nil, nil, fmt.Errorf("argon2id: parse version: %w", err)
	}
	if version != argon2.Version {
		return p, nil, nil, fmt.Errorf("argon2id: unsupported version %d", version)
	}

	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.Memory, &p.Iterations, &p.Parallelism); err != nil {
		return p, nil, nil, fmt.Errorf("argon2id: parse parameters: %w", err)
	}

	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil {
		return p, nil, nil, fmt.Errorf("argon2id: decode salt: %w", err)
	}
	p.SaltLength = uint32(len(salt))

	key, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil {
		return p, nil, nil, fmt.Errorf("argon2id: decode key: %w", err)
	}
	p.KeyLength = uint32(len(key))

	return p, salt, key, nil
}
