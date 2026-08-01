import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TexViewer } from './tex-viewer'

describe('TexViewer', () => {
  it('previews a document whose stored preamble has packages', async () => {
    const source = '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nТы солнышко, самое лучшее\n\\end{document}'
    const { container } = render(<TexViewer tex={source} />)
    const host = container.firstElementChild?.firstElementChild as HTMLDivElement

    await waitFor(() => expect(host.shadowRoot?.textContent).toContain('Ты солнышко, самое лучшее'))
    expect(container.querySelector('pre')).toBeNull()
  })

  it('keeps display math in display style while inline math stays compact', async () => {
    const source = '\\documentclass{article}\n\\begin{document}\n$\\int_0^1$ and $$\\int_0^1 \\frac{x}{1+x}$$\n\\[\\sum_{k=1}^n k\\]\n\\begin{equation}\\int_0^1 x^2\\,dx\\end{equation}\n\\begin{align}\\int_0^1 x\\,dx \\\\ \\sum_{k=1}^n k\\end{align}\n\\end{document}'
    const { container } = render(<TexViewer tex={source} />)
    const host = container.firstElementChild?.firstElementChild as HTMLDivElement

    await waitFor(() => {
      expect(host.shadowRoot?.querySelectorAll('.katex-display')).toHaveLength(5)
    })
    expect(host.shadowRoot?.querySelector('.katex:not(.katex-display) .op-symbol.small-op')).toBeTruthy()
    expect(host.shadowRoot?.querySelector('.katex-display .op-symbol.large-op')).toBeTruthy()
    expect(host.shadowRoot?.querySelector('.katex-display .frac-line')).toBeTruthy()
    expect(host.shadowRoot?.querySelector('.katex-display .op-symbol.large-op')).toBeTruthy()
    expect(host.shadowRoot?.querySelector('style')?.textContent).toContain('.katex-display > .katex { font-size: 1.5em; }')
  })
})
