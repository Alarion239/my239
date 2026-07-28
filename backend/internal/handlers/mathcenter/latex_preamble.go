package mathcenter

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

const maxLatexPreambleBytes = 64 * 1024

// DefaultLatexPreamble is deliberately ordinary LaTeX: it works for Russian
// text and gives teachers the common AMS/math, layout, graphics, colour, list,
// table, TikZ, and hyperlink tools without requiring a boilerplate document.
const DefaultLatexPreamble = `\documentclass[12pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T2A]{fontenc}
\usepackage[main=russian,english]{babel}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{amsfonts}
\usepackage{amsthm}
\usepackage{mathtools}
\usepackage{bm}
\usepackage{mathrsfs}
\usepackage{geometry}
\usepackage{graphicx}
\usepackage{xcolor}
\usepackage{enumitem}
\usepackage{array}
\usepackage{booktabs}
\usepackage{tikz}
\usepackage{hyperref}
\geometry{margin=2cm}

\newcommand{\R}{\mathbb{R}}
\newcommand{\N}{\mathbb{N}}
\newcommand{\Z}{\mathbb{Z}}
\newcommand{\Q}{\mathbb{Q}}
\newcommand{\C}{\mathbb{C}}
\newcommand{\E}{\mathbb{E}}
\newcommand{\abs}[1]{\left|#1\right|}
\newcommand{\norm}[1]{\left\lVert#1\right\rVert}
\newcommand{\set}[1]{\left\{#1\right\}}
\newcommand{\deriv}[2]{\frac{d #1}{d #2}}
\newcommand{\pderiv}[2]{\frac{\partial #1}{\partial #2}}
\DeclareMathOperator{\rank}{rank}
\DeclareMathOperator{\supp}{supp}
\DeclareMathOperator{\lcm}{lcm}
\DeclareMathOperator{\tr}{tr}`

type latexPreambleView struct {
	Preamble string `json:"preamble"`
}

type latexPreambleRequest struct {
	Preamble string `json:"preamble"`
}

func centerLatexPreamble(ctx context.Context, database *db.DB, centerID int64) (string, error) {
	var preamble string
	err := database.Pool().QueryRow(ctx,
		`SELECT preamble FROM math_center_latex_settings WHERE math_center_id = $1`,
		centerID,
	).Scan(&preamble)
	if err != nil {
		if err == pgx.ErrNoRows {
			return DefaultLatexPreamble, nil
		}
		return ``, err
	}
	if strings.TrimSpace(preamble) == `` {
		return DefaultLatexPreamble, nil
	}
	return preamble, nil
}

func GetLatexPreamble(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		centerID, err := pathInt64(r, `centerID`)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, `invalid center id`)
			return
		}
		q := store.New(database.Pool())
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		teacher, student, err := membership(r.Context(), r, q, userID, centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), `latex preamble: membership`, err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, `internal error`)
			return
		}
		if !teacher && !student {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, `no access to this center`)
			return
		}
		preamble, err := centerLatexPreamble(r.Context(), database, centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), `latex preamble: get`, err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, `failed to load latex preamble`)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, latexPreambleView{Preamble: preamble})
	}
}

func UpdateLatexPreamble(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		var req latexPreambleRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		req.Preamble = strings.TrimSpace(req.Preamble)
		if message := validateLatexPreamble(req.Preamble); message != `` {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, message)
			return
		}
		_, err := database.Pool().Exec(r.Context(), `
			INSERT INTO math_center_latex_settings (math_center_id, preamble)
			VALUES ($1, $2)
			ON CONFLICT (math_center_id) DO UPDATE
			SET preamble = EXCLUDED.preamble, updated_at = NOW()
		`, centerID, req.Preamble)
		if err != nil {
			logger.LogErrorContext(r.Context(), `latex preamble: update`, err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, `failed to save latex preamble`)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, latexPreambleView{Preamble: req.Preamble})
	}
}

func validateLatexPreamble(preamble string) string {
	if preamble == `` {
		return `latex preamble is required`
	}
	if len(preamble) > maxLatexPreambleBytes {
		return fmt.Sprintf(`latex preamble exceeds %d bytes`, maxLatexPreambleBytes)
	}
	if !utf8.ValidString(preamble) {
		return `latex preamble must be valid UTF-8`
	}
	if !strings.Contains(preamble, `\documentclass`) {
		return `latex preamble must contain \documentclass`
	}
	if strings.Contains(preamble, `\begin{document}`) || strings.Contains(preamble, `\end{document}`) {
		return `latex preamble must not contain document body markers`
	}
	return ``
}

// normalizeTexSource accepts a complete document or a body-only snippet. A
// complete document is preserved byte-for-byte so existing sources do not get
// reformatted; body-only input receives the built-in fallback preamble.
func normalizeTexSource(tex string) string {
	if strings.TrimSpace(tex) == `` {
		return tex
	}
	if strings.Contains(tex, `\begin{document}`) && strings.Contains(tex, `\end{document}`) {
		return tex
	}
	input := strings.TrimSpace(tex)
	if strings.Contains(input, `\begin{document}`) {
		return input + `\n\end{document}`
	}
	if strings.Contains(input, `\end{document}`) {
		return DefaultLatexPreamble + `\n\n\begin{document}\n` + input
	}
	if strings.Contains(input, `\documentclass`) || strings.Contains(input, `\usepackage`) ||
		strings.Contains(input, `\newcommand`) || strings.Contains(input, `\Declare`) {
		return input + `\n\begin{document}\n\end{document}`
	}
	return DefaultLatexPreamble + `\n\n\begin{document}\n` + input + `\n\end{document}`
}
