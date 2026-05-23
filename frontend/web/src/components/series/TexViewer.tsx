// TexViewer renders a full LaTeX document (with preamble,
// `\begin{document}`, `\usepackage[russian]{babel}`, etc.) to HTML using
// LaTeX.js, then displays it in an isolated iframe. Two reasons for the
// iframe rather than inlining:
//
//   • LaTeX.js's CSS uses bare tag selectors (h2, p, body, …) that
//     would otherwise collide with our app's styles.
//   • Anything weird in the rendered HTML (mismatched lists, stray
//     scripts that LaTeX.js may emit) stays sandboxed.
//
// The renderer itself (~500 KiB minified) is dynamically imported so
// the main bundle stays slim — students who never open the side panel
// don't pay for it.
//
// Known limitations of LaTeX.js for our context (Russian-babel psets):
//   • Cyrillic text renders fine via system fonts (no LaTeX-specific
//     font needed since Computer Modern doesn't ship Cyrillic anyway).
//   • Math typesetting uses KaTeX; the bundled KaTeX fonts are loaded
//     via relative `url(...)` in the CSS which the iframe srcdoc can't
//     resolve. Math glyphs fall back to system fonts and look slightly
//     off — fix is to bundle the fonts as data URLs, deferred until we
//     see whether teachers actually hit it.
//   • Custom .sty packages, TikZ, and any \write18 are unsupported by
//     design; we surface the parse error inline.

import {useEffect, useRef, useState} from 'react'

interface CompiledLatex {
    parse: (tex: string, opts: {generator: unknown}) => {domFragment: () => DocumentFragment}
    HtmlGenerator: new (opts: {hyphenate?: boolean}) => unknown
    css: string
}

// Lazy-load latex.js and its CSS as raw strings so we can inline them
// in the iframe srcdoc. The `?raw` suffix is a Vite feature.
let cached: Promise<CompiledLatex> | null = null
function loadLatex(): Promise<CompiledLatex> {
    if (cached) return cached
    cached = Promise.all([
        import('latex.js'),
        // LaTeX.js's package.json `exports` map doesn't expose the CSS
        // subpaths, so we vendor them under ./latex-css/ and import as
        // raw strings to inline into the iframe srcdoc.
        import('./latex-css/base.css?raw'),
        import('./latex-css/article.css?raw'),
        import('./latex-css/katex.css?raw'),
    ]).then(([mod, baseCss, articleCss, katexCss]) => ({
        parse: (mod as unknown as CompiledLatex).parse,
        HtmlGenerator: (mod as unknown as CompiledLatex).HtmlGenerator,
        css: `${baseCss.default}\n${articleCss.default}\n${katexCss.default}`,
    }))
    return cached
}

export interface TexViewerProps {
    tex: string
    // Optional fixed height; defaults to 720px which matches our PDF
    // panel so the page layout doesn't jump when toggling.
    heightPx?: number
}

export function TexViewer({tex, heightPx = 720}: TexViewerProps) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(null)
        loadLatex()
            .then(({parse, HtmlGenerator, css}) => {
                if (cancelled) return
                let bodyHTML: string
                try {
                    const generator = new HtmlGenerator({hyphenate: false})
                    const doc = parse(tex, {generator})
                    // Wrap the fragment in a host node so we can serialize
                    // it back to a string for srcdoc.
                    const host = document.createElement('div')
                    host.appendChild(doc.domFragment())
                    bodyHTML = host.innerHTML
                } catch (e) {
                    setLoading(false)
                    setError(e instanceof Error ? e.message : 'Не удалось разобрать LaTeX')
                    return
                }
                // The extra body style overrides LaTeX.js's Computer-Modern
                // family with a Cyrillic-capable system stack. Without it
                // the .latex font-family kicks in and Cyrillic falls back
                // to the browser's last-resort font, which is jarring.
                const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><style>${css}
body {
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Roboto, "Noto Sans", sans-serif;
}
.latex, .body-text, p, li {
  font-family: inherit;
}
</style></head><body>${bodyHTML}</body></html>`
                if (iframeRef.current) iframeRef.current.srcdoc = html
                setLoading(false)
            })
            .catch(e => {
                if (cancelled) return
                setLoading(false)
                setError(e instanceof Error ? e.message : 'Не удалось загрузить рендерер')
            })
        return () => {
            cancelled = true
        }
    }, [tex])

    return (
        <div className="w-full">
            {loading ? <p className="text-[13px] italic text-muted mb-2">Рендерим LaTeX…</p> : null}
            {error ? (
                <pre className="text-[12px] text-danger bg-red-50 border border-red-200 rounded-lg p-3 whitespace-pre-wrap">
                    {error}
                </pre>
            ) : null}
            <iframe
                ref={iframeRef}
                title="LaTeX preview"
                className="w-full rounded-lg bg-white"
                style={{border: '1px solid #e1e4ea', height: heightPx}}
            />
        </div>
    )
}
