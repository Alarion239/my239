// Shared LaTeX authoring helpers. Editors accept either a complete document or
// the body of one; the API stores a complete document so every viewer has the
// same parsing context.

export const DEFAULT_LATEX_PREAMBLE = [
  '\\documentclass[12pt]{article}',
  '\\usepackage[utf8]{inputenc}',
  '\\usepackage[T2A]{fontenc}',
  '\\usepackage[main=russian,english]{babel}',
  '\\usepackage{amsmath}',
  '\\usepackage{amssymb}',
  '\\usepackage{amsfonts}',
  '\\usepackage{amsthm}',
  '\\usepackage{mathtools}',
  '\\usepackage{bm}',
  '\\usepackage{mathrsfs}',
  '\\usepackage{geometry}',
  '\\usepackage{graphicx}',
  '\\usepackage{xcolor}',
  '\\usepackage{enumitem}',
  '\\usepackage{array}',
  '\\usepackage{booktabs}',
  '\\usepackage{tikz}',
  '\\usepackage{hyperref}',
  '\\geometry{margin=2cm}',
  '',
  '\\newcommand{\\R}{\\mathbb{R}}',
  '\\newcommand{\\N}{\\mathbb{N}}',
  '\\newcommand{\\Z}{\\mathbb{Z}}',
  '\\newcommand{\\Q}{\\mathbb{Q}}',
  '\\newcommand{\\C}{\\mathbb{C}}',
  '\\newcommand{\\E}{\\mathbb{E}}',
  '\\newcommand{\\abs}[1]{\\left|#1\\right|}',
  '\\newcommand{\\norm}[1]{\\left\\lVert#1\\right\\rVert}',
  '\\newcommand{\\set}[1]{\\left\\{#1\\right\\}}',
  '\\newcommand{\\deriv}[2]{\\frac{d #1}{d #2}}',
  '\\newcommand{\\pderiv}[2]{\\frac{\\partial #1}{\\partial #2}}',
  '\\DeclareMathOperator{\\rank}{rank}',
  '\\DeclareMathOperator{\\supp}{supp}',
  '\\DeclareMathOperator{\\lcm}{lcm}',
  '\\DeclareMathOperator{\\tr}{tr}',
].join('\n')

const DOCUMENT_BEGIN = /\\begin\s*\{\s*document\s*\}/
const DOCUMENT_END = /\\end\s*\{\s*document\s*\}/
const PREAMBLE_COMMAND = /\\(?:documentclass|usepackage|newcommand|renewcommand|Declare[A-Za-z]+)\b/

export function normalizeLatexSource(source: string, preamble = DEFAULT_LATEX_PREAMBLE): string {
  const input = source.trim()
  if (!input) return ''

  const configuredPreamble = (preamble.trim() || DEFAULT_LATEX_PREAMBLE).trim()
  const hasBegin = DOCUMENT_BEGIN.test(input)
  const hasEnd = DOCUMENT_END.test(input)
  const hasDocumentClass = /\\documentclass\b/.test(input)

  if (hasBegin && hasEnd) return input

  if (hasBegin) {
    const withPreamble = hasDocumentClass ? input : configuredPreamble + '\n\n' + input
    return withPreamble + (hasEnd ? '' : '\n\\end{document}')
  }

  if (hasEnd) {
    const withPreamble = hasDocumentClass ? input : configuredPreamble + '\n\n' + input
    return withPreamble.replace(DOCUMENT_END, '\\begin{document}\n\\end{document}')
  }

  if (PREAMBLE_COMMAND.test(input)) {
    return input + '\n\\begin{document}\n\\end{document}'
  }

  return configuredPreamble + '\n\n\\begin{document}\n' + input + '\n\\end{document}'
}
