/**
 * What the draft would actually produce, as the Host answered it.
 *
 * The section list is the working view: it names what a `remove` can target and
 * shows what a `substitute` changed. Section text renders literally — never as
 * Markdown, which would swallow the `{{…}}` groups and fences a prompt carries.
 */

import { useMemo, useState } from 'react'
import { Button, Pill, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PromptPresetPreviewSection, PromptPresetWarningCode } from '@deepseek-ai/dsh-prompt-presets/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PreviewState } from './section-store.ts'
import type { PromptPresetKey } from './locales.ts'
import css from './PromptPreview.module.css'

/** How each Host warning code is worded; the Host sends codes, never sentences. */
const WARNING_KEYS = {
  'invalid-pattern': 'preview.warn.invalidPattern',
  'pattern-too-long': 'preview.warn.patternTooLong',
  'unknown-section': 'preview.warn.unknownSection',
  'no-match': 'preview.warn.noMatch',
  'protected-section-kept': 'preview.warn.protectedKept',
  'complete-section-overridden': 'preview.warn.completeOverridden',
  'render-failed': 'preview.warn.renderFailed',
  'unknown-preset': 'preview.warn.unknownPreset',
  'empty-prompt': 'preview.warn.emptyPrompt',
} as const satisfies Record<PromptPresetWarningCode, PromptPresetKey>

/**
 * The sentence one warning code gets.
 * @param code - the code the Host sent, which a newer Host may have widened.
 * @returns its locale key, or the fallback that prints the code verbatim.
 */
function warningKey(code: string): PromptPresetKey {
  return Object.hasOwn(WARNING_KEYS, code)
    ? WARNING_KEYS[code as PromptPresetWarningCode]
    : 'preview.warn.unknown'
}

/** What one section row reports against the untransformed assembly. */
type Change = 'added' | 'removed' | 'changed' | undefined

/** Everything the preview pane renders and reports. */
export interface PromptPresetPreviewProps {
  /** The Host's last answer. */
  preview: PreviewState
  /** Whether a session is open to preview against. */
  hasSession: boolean
  /** Redraw now, ignoring the debounce. */
  onRefresh: () => void
  /** Localized copy. */
  t: TranslateNS<'settings.promptPreset'>
}

/** One row of the section list, with what the rules did to it. */
interface Row {
  section: PromptPresetPreviewSection
  change: Change
}

/**
 * Render the preview: warnings, then either the section list or the prompt.
 * @param props - the Host's answer, the session state, and localized copy.
 * @returns the pane.
 */
export function PromptPresetPreview({ preview, hasSession, onRefresh, t }: PromptPresetPreviewProps) {
  const [view, setView] = useState<'sections' | 'prompt'>('sections')

  const rows = useMemo((): Row[] => {
    const before = new Map(preview.baseline.map(section => [section.name, section.text]))
    const after = new Set(preview.sections.map(section => section.name))
    const kept: Row[] = preview.sections.map((section) => {
      const previous = before.get(section.name)
      if (previous === undefined) return { section, change: 'added' }
      return { section, change: previous === section.text ? undefined : 'changed' }
    })
    const dropped: Row[] = preview.baseline
      .filter(section => !after.has(section.name))
      .map(section => ({ section, change: 'removed' as const }))
    return [...kept, ...dropped]
  }, [preview.baseline, preview.sections])

  if (!hasSession) return <p className={css.empty}>{t('preview.needsSession')}</p>

  return (
    <section className={css.root} aria-label={t('preview.heading')}>
      <header className={css.head}>
        <h4 className={css.heading}>{t('preview.heading')}</h4>
        <Pill active={view === 'sections'} onClick={() => { setView('sections') }}>
          {t('preview.sections')}
        </Pill>
        <Pill active={view === 'prompt'} onClick={() => { setView('prompt') }}>
          {t('preview.prompt')}
        </Pill>
        <Button size="sm" onClick={onRefresh}>{t('preview.refresh')}</Button>
      </header>

      {preview.warnings.length > 0 && (
        <ul className={css.warnings}>
          {preview.warnings.map((warning, index) => (
            <li className={css.warning} role="alert" key={`${warning.code}-${String(index)}`}>
              {t(warningKey(warning.code), {
                position: String((warning.rule ?? 0) + 1),
                section: warning.section ?? '',
                detail: warning.detail ?? '',
              })}
            </li>
          ))}
        </ul>
      )}

      {preview.status === 'loading' && <p className={css.status}>{t('preview.loading')}</p>}
      {preview.status === 'error' && (
        <p className={css.error} role="alert">{t('preview.error', { message: preview.error ?? '' })}</p>
      )}

      {view === 'sections'
        ? (
          <ul className={css.sections}>
            {rows.map(({ section, change }) => (
              <li className={css.section} key={`${change ?? 'kept'}-${section.name}`}>
                <span className={css.sectionHead}>
                  <code className={css.sectionName}>{section.name}</code>
                  {change !== undefined && <Tag>{t(`preview.tag.${change}`)}</Tag>}
                  {section.protectedSection === true && <Tag>{t('preview.tag.protected')}</Tag>}
                </span>
                <pre className={change === 'removed' ? css.removedText : css.text}>{section.text}</pre>
              </li>
            ))}
          </ul>
        )
        : <pre className={css.prompt}>{preview.prompt}</pre>}
    </section>
  )
}
