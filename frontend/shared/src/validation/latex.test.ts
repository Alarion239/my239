import { describe, expect, it } from 'vitest'
import { DEFAULT_LATEX_PREAMBLE, normalizeLatexSource } from './latex'

describe('normalizeLatexSource', () => {
  it('wraps body-only text with the configured preamble and document markers', () => {
    const result = normalizeLatexSource('Решите $x^2=1$.', '\\documentclass{custom}')
    expect(result).toBe('\\documentclass{custom}\n\n\\begin{document}\nРешите $x^2=1$.\n\\end{document}')
  })

  it('leaves a complete document unchanged', () => {
    const source = '\\documentclass{article}\n\\begin{document}\nТекст\n\\end{document}'
    expect(normalizeLatexSource(source)).toBe(source)
  })

  it('uses the standard Russian math preamble by default', () => {
    expect(normalizeLatexSource('Текст')).toContain(DEFAULT_LATEX_PREAMBLE)
    expect(normalizeLatexSource('Текст')).toContain('\\begin{document}')
  })
})
