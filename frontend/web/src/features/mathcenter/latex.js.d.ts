// latex.js ships no type declarations. We use only `parse` and `HtmlGenerator`,
// plus the `domFragment()` method on the parsed result — declared minimally here.
declare module 'latex.js' {
  export class HtmlGenerator {
    constructor(options?: { hyphenate?: boolean })
  }

  export interface LaTeXDocument {
    domFragment(): DocumentFragment
  }

  export function parse(
    latex: string,
    options: { generator: HtmlGenerator },
  ): LaTeXDocument
}
