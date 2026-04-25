// Package migrations exposes the SQL migration files as an embedded
// filesystem so the binary is self-contained and doesn't need the
// migrations/ directory shipped alongside it.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
