.DEFAULT_GOAL := help
GO ?= go

.PHONY: help build test test-race lint lint-fix fmt vet sqlc vuln tidy

help: ## List available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

build: ## Compile all packages
	$(GO) build ./...

test: ## Run tests
	$(GO) test ./...

test-race: ## Run tests with the race detector and shuffled order
	$(GO) test -race -shuffle=on ./...

lint: ## Run golangci-lint
	golangci-lint run

lint-fix: ## Run golangci-lint with autofix
	golangci-lint run --fix

fmt: ## Format the code (gofumpt + import grouping)
	golangci-lint fmt

vet: ## Run go vet
	$(GO) vet ./...

sqlc: ## Regenerate the sqlc data layer
	sqlc generate

vuln: ## Scan for known vulnerabilities
	$(GO) run golang.org/x/vuln/cmd/govulncheck@latest ./...

tidy: ## Tidy module dependencies
	$(GO) mod tidy
