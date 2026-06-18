import { useEffect, useRef, useState } from 'react'

// TexViewer renders a full LaTeX document with crisp KaTeX math.
//
// Why a shadow root: latex.js generates DOM with very broad CSS selectors
// (body, .page, p, h1…) and ships a large stylesheet to match. Mounting both
// into an OPEN shadow root scopes those rules so they cannot leak into — or be
// clobbered by — the app's Tailwind layer.
//
// The crispness problem: KaTeX's stylesheet points at its glyph fonts with
// RELATIVE `url(fonts/…)` references. Those resolve against the document, not
// the shadow root, so inside a shadow root they 404 and the browser falls back
// to blurry system glyphs. We fix it by importing the CSS as raw text, resolving
// every KaTeX font file to a Vite-bundled (absolute, hashed) URL, and rewriting
// the references before injecting the CSS into the shadow root.

// Vite bundles every KaTeX font file and hands back its final hashed URL. The
// keys are the source paths under node_modules; we index them by basename.
//
// The pattern is RELATIVE to this file (../../../../node_modules) rather than
// project-root-absolute (/node_modules/…): in this npm workspace `katex` is
// hoisted to frontend/node_modules, not frontend/web/node_modules, so a
// root-anchored glob would silently match nothing and ship blurry math.
const fontUrls = import.meta.glob('../../../../node_modules/katex/dist/fonts/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

// basename -> bundled URL, e.g. "KaTeX_Main-Regular.woff2" -> "/assets/…woff2".
const fontUrlByName = new Map<string, string>()
for (const [path, url] of Object.entries(fontUrls)) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  fontUrlByName.set(name, url)
}

// Loud guard: if the glob ever matches nothing (e.g. KaTeX's install path
// moved), the font rewrite becomes a silent no-op and math renders blurry.
// Surface that in dev instead of shipping broken glyphs.
if (import.meta.env.DEV && fontUrlByName.size === 0) {
  console.error(
    '[TexViewer] No KaTeX font files resolved — math will render blurry. Check the import.meta.glob path in tex-viewer.tsx.',
  )
}

// rewriteKatexFontUrls swaps every `url(fonts/<file>)` reference in the KaTeX
// stylesheet for its bundled absolute URL so the @font-face families resolve
// inside the shadow root.
function rewriteKatexFontUrls(css: string): string {
  return css.replace(/url\((['"]?)fonts\/([^)'"]+)\1\)/g, (whole, _q, file: string) => {
    const url = fontUrlByName.get(file)
    return url ? `url("${url}")` : whole
  })
}

// :host keeps body text in our Cyrillic sans and inherits the surrounding ink
// colour, while KaTeX math keeps its own families for sharp glyphs.
const HOST_CSS = `
:host {
  display: block;
  color: inherit;
  font-family: var(--font-sans);
  line-height: 1.5;
}
.katex { color: inherit; }
`

interface TexAssets {
  parse: typeof import('latex.js').parse
  HtmlGenerator: typeof import('latex.js').HtmlGenerator
  styleText: string
}

// Lazy-load latex.js + assemble the shadow-root stylesheet exactly once; cache
// the promise so every viewer instance shares the same import and CSS work.
let assetsPromise: Promise<TexAssets> | null = null

function loadTexAssets(): Promise<TexAssets> {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      // latex.js's package "exports" map blocks deep subpath imports of its
      // dist CSS, so the base/article stylesheets are vendored locally (see
      // ./vendor) with their broken relative @import lines already removed.
      const [latex, katexCssRaw, baseCssRaw, articleCssRaw] = await Promise.all([
        import('latex.js'),
        import('katex/dist/katex.min.css?raw').then((m) => m.default),
        import('./vendor/latexjs-base.css?raw').then((m) => m.default),
        import('./vendor/latexjs-article.css?raw').then((m) => m.default),
      ])
      const styleText = [
        rewriteKatexFontUrls(katexCssRaw),
        baseCssRaw,
        articleCssRaw,
        HOST_CSS,
      ].join('\n')
      return { parse: latex.parse, HtmlGenerator: latex.HtmlGenerator, styleText }
    })()
  }
  return assetsPromise
}

export interface TexViewerProps {
  tex: string
  className?: string
}

// TexViewer parses `tex` and renders it into an open shadow root, re-rendering
// when `tex` changes. Parse errors are shown inline instead of crashing.
export function TexViewer({ tex, className }: TexViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const shadowRef = useRef<ShadowRoot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (!host) return

    // Create the open shadow root once and reuse it across renders.
    if (!shadowRef.current) {
      shadowRef.current = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    }
    const shadow = shadowRef.current

    loadTexAssets()
      .then(({ parse, HtmlGenerator, styleText }) => {
        if (cancelled) return
        // Clear previous content before re-rendering.
        shadow.replaceChildren()

        const style = document.createElement('style')
        style.textContent = styleText
        shadow.appendChild(style)

        const generator = parse(tex, { generator: new HtmlGenerator({ hyphenate: false }) })
        // domFragment() returns the rendered document body fragment.
        shadow.appendChild(generator.domFragment())
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        shadow?.replaceChildren()
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [tex])

  // Drop the rendered shadow content when the component unmounts.
  useEffect(() => {
    return () => {
      shadowRef.current?.replaceChildren()
    }
  }, [])

  return (
    <div className={className}>
      <div ref={hostRef} />
      {error && (
        <pre className="mt-2 overflow-auto rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          {error}
        </pre>
      )}
    </div>
  )
}
