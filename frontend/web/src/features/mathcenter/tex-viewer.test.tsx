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
})
