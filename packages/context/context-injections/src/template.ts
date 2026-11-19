/**
 * Templates over injected text: constant text with named `{{variable}}`
 * placeholders. A row's shipped template states how its producer builds the
 * text; matching an injected text against it recovers the variables, and the
 * person's template is rendered with them.
 */

/** The placeholder that always stands for the whole original text. */
export const ORIGINAL_TEXT_VARIABLE = 'text'

const PLACEHOLDER = /\{\{[A-Za-z][A-Za-z0-9]*\}\}/g

/** The variable name a placeholder names. */
const nameOf = (placeholder: string): string => placeholder.slice(2, -2)

/** A shipped template compiled for matching. */
export interface CompiledTemplate {
  /** The template as shipped. */
  readonly source: string
  /** Variable names in first-appearance order, without `text`. */
  readonly variables: readonly string[]
  /** Length of the constant text; more constant text means a more specific shape. */
  readonly literalLength: number
  /**
   * Recover the variables of a text the producer built from this template.
   * @param text - one injected text.
   * @returns each variable's value, or undefined when the text has another shape.
   */
  match(text: string): ReadonlyMap<string, string> | undefined
}

function escapeLiteral(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/**
 * Compile a shipped template. Each variable matches any text, newlines
 * included; a variable repeated in the template must take the same value at
 * every occurrence.
 * @param source - the shipped template.
 * @returns the compiled template.
 */
export function compileTemplate(source: string): CompiledTemplate {
  const names: string[] = []
  let pattern = '^'
  let last = 0
  let literalLength = 0
  for (const placeholder of source.matchAll(PLACEHOLDER)) {
    const literal = source.slice(last, placeholder.index)
    literalLength += literal.length
    pattern += `${escapeLiteral(literal)}([\\s\\S]*?)`
    names.push(nameOf(placeholder[0]))
    last = placeholder.index + placeholder[0].length
  }
  const tail = source.slice(last)
  const expression = new RegExp(`${pattern}${escapeLiteral(tail)}$`)
  return {
    source,
    literalLength: literalLength + tail.length,
    variables: [...new Set(names)].filter(name => name !== ORIGINAL_TEXT_VARIABLE),
    match(text) {
      const found = expression.exec(text)
      if (found === null) return undefined
      const values = new Map<string, string>()
      for (const [index, name] of names.entries()) {
        const value = found[index + 1]
        /* v8 ignore next -- every group is a lazy any-text match, so each participates in a match. */
        if (value === undefined) return undefined
        const seen = values.get(name)
        if (seen !== undefined && seen !== value) return undefined
        values.set(name, value)
      }
      values.set(ORIGINAL_TEXT_VARIABLE, text)
      return values
    },
  }
}

/**
 * Render a person's template. A placeholder naming a recovered variable
 * becomes its value; any other text, including braces around an unknown
 * name, reaches the model as written.
 * @param template - the person's template.
 * @param values - the recovered variables, `text` included.
 * @returns the text the model receives.
 */
export function renderTemplate(template: string, values: ReadonlyMap<string, string>): string {
  return template.replace(PLACEHOLDER, (placeholder: string) => values.get(nameOf(placeholder)) ?? placeholder)
}

/**
 * The variable names a template uses.
 * @param template - any template.
 * @returns the names in first-appearance order, `text` included when used.
 */
export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map(found => nameOf(found[0])))]
}
