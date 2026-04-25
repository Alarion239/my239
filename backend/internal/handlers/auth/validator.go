package auth

import "github.com/go-playground/validator/v10"

// validate is the shared validator instance. It is safe for concurrent use
// and caches struct metadata across requests, so we build it once.
var validate = validator.New(validator.WithRequiredStructEnabled())
