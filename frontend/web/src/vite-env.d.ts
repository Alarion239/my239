/// <reference types="vite/client" />

// Vite's `?raw` query parameter inlines the file contents as a string.
declare module '*?raw' {
    const content: string
    export default content
}

// latex.js doesn't ship .d.ts files. The pieces we use are typed in
// TexViewer.tsx via a local `CompiledLatex` interface; this just keeps
// the bare `import 'latex.js'` from erroring out.
declare module 'latex.js' {
    export const parse: unknown
    export const HtmlGenerator: unknown
}
