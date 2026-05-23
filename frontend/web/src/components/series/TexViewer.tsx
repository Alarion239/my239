// TexViewer renders a full LaTeX document (with preamble,
// `\begin{document}`, `\usepackage[russian]{babel}`, etc.) to HTML
// using LaTeX.js and paints it directly into our React tree via Shadow
// DOM. The shadow root keeps LaTeX.js's bare tag selectors (h2, p,
// body, .body-text, …) from leaking into our app, while still letting
// the rendered output flow as a normal block in the surrounding card —
// no iframe, no scrollbar-in-scrollbar, content sizes itself.
//
// The renderer (~500 KiB minified) is lazy-imported so series that
// only have a PDF never download the LaTeX.js bundle.
//
// Known limitation for Russian-babel psets:
//   • Math typesetting uses KaTeX whose font files are referenced via
//     relative `url(...)` in the CSS. Shadow DOM resolves those
//     relative to the document, which doesn't have them; math glyphs
//     fall back to system fonts. Cyrillic text renders cleanly via
//     the system font stack we set on the body.
//   • Custom .sty packages, TikZ, and \write18 are unsupported by
//     LaTeX.js; we surface the parse error inline.

import {useEffect, useRef, useState} from 'react'

interface CompiledLatex {
    parse: (tex: string, opts: {generator: unknown}) => {domFragment: () => DocumentFragment}
    HtmlGenerator: new (opts: {hyphenate?: boolean}) => unknown
    css: string
}

let cached: Promise<CompiledLatex> | null = null
function loadLatex(): Promise<CompiledLatex> {
    if (cached) return cached
    cached = Promise.all([
        import('latex.js'),
        // LaTeX.js's package.json `exports` map doesn't expose the CSS
        // subpaths, so we vendor them under ./latex-css/ and import as
        // raw strings.
        import('./latex-css/base.css?raw'),
        import('./latex-css/article.css?raw'),
        import('./latex-css/katex.css?raw'),
    ]).then(([mod, baseCss, articleCss, katexCss]) => ({
        parse: (mod as unknown as CompiledLatex).parse,
        HtmlGenerator: (mod as unknown as CompiledLatex).HtmlGenerator,
        // Wrapping our padding + font stack in `:host` keeps it scoped
        // to the shadow root. We override LaTeX.js's `.latex` /
        // `.body-text` font-family so Cyrillic doesn't fall through to
        // a last-resort font (Computer Modern has no Cyrillic glyphs).
        css: `${baseCss.default}\n${articleCss.default}\n${katexCss.default}
:host {
    display: block;
    padding: 4px 2px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Roboto, "Noto Sans", sans-serif;
    color: #1f2933;
    line-height: 1.45;
}
.latex, .body-text, p, li, h1, h2, h3, h4 {
    font-family: inherit !important;
}
`,
    }))
    return cached
}

export interface TexViewerProps {
    tex: string
    // Optional CSS class applied to the host element. The host is a
    // plain block; let callers control height/overflow from the
    // outside (e.g., `max-h-[720px] overflow-auto` for a scrollable
    // panel).
    className?: string
}

export function TexViewer({tex, className}: TexViewerProps) {
    const hostRef = useRef<HTMLDivElement | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(null)
        loadLatex()
            .then(({parse, HtmlGenerator, css}) => {
                if (cancelled) return
                const host = hostRef.current
                if (!host) return
                // Attach (or reuse) the shadow root. `mode: 'open'`
                // lets the inspector see it; behavioral isolation
                // doesn't depend on the mode.
                const shadow = host.shadowRoot ?? host.attachShadow({mode: 'open'})

                let fragment: DocumentFragment
                try {
                    const generator = new HtmlGenerator({hyphenate: false})
                    const doc = parse(tex, {generator})
                    fragment = doc.domFragment()
                } catch (e) {
                    setLoading(false)
                    setError(e instanceof Error ? e.message : 'Не удалось разобрать LaTeX')
                    // Clear any stale render so the error isn't shown
                    // alongside outdated output.
                    while (shadow.firstChild) shadow.removeChild(shadow.firstChild)
                    return
                }

                // Replace the whole shadow content atomically: <style>
                // first so the rendered nodes paint with the right
                // typography on first frame.
                while (shadow.firstChild) shadow.removeChild(shadow.firstChild)
                const styleEl = document.createElement('style')
                styleEl.textContent = css
                shadow.appendChild(styleEl)
                shadow.appendChild(fragment)
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
        <div className={className}>
            {loading ? <p className="text-[13px] italic text-muted mb-2">Рендерим LaTeX…</p> : null}
            {error ? (
                <pre className="text-[12px] text-danger bg-red-50 border border-red-200 rounded-lg p-3 whitespace-pre-wrap mb-2">
                    {error}
                </pre>
            ) : null}
            <div ref={hostRef}/>
        </div>
    )
}
