/**
 * What the draft would actually produce, as the Host answered it.
 *
 * The section list is the working view: it names what a `remove` can target and
 * shows what a `substitute` changed. Section text renders literally — never as
 * Markdown, which would swallow the `{{…}}` groups and fences a prompt carries.
 */

import { useMemo, useState } from 'react'
import {
  Button, Checkbox, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconRefreshOutlineRegular,
  IconWarningOutlineRegular, Modal, Pill, Tag, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives/client'
import type { PromptPresetPreviewSection, PromptPresetWarningCode } from '@deepseek-ai/dsh-prompt-presets/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots/client'
import type { PreviewState } from './section-store.ts'
import type { PromptPresetKey } from './locales.ts'
import { PreviewText, promptSource, sectionExcerpt } from './PreviewText.tsx'
import css from './PromptPreview.module.css'

/** How each Host warning code is worded; the Host sends codes, never sentences. */
const WARNING_KEYS = {
  'invalid-pattern': 'preview.warn.invalidPattern',
  'pattern-too-long': 'preview.warn.patternTooLong',
  'invalid-section-id': 'preview.warn.invalidSectionId',
  'duplicate-section': 'preview.warn.duplicateSection',
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

/** Each change wears the status color a diff gives it. */
const CHANGE_TONE = { added: 'success', removed: 'danger', changed: 'warning' } as const

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

/** Rows keep the full baseline for inspection, including sections missing from the candidate. */
interface Row {
  section: PromptPresetPreviewSection
  baseline: PromptPresetPreviewSection | undefined
  change: Change
}

function sectionRows(preview: Pick<PreviewState, 'sections' | 'baseline'>): Row[] {
  const before = new Map(preview.baseline.map(section => [section.name, section]))
  const present = new Set(preview.sections.map(section => section.name))
  const rows: Row[] = []
  // Anchor removed sections before the next surviving baseline neighbor; candidate order stays authoritative.
  const preceding = new Map<string, Row[]>()
  let removed: Row[] = []
  for (const section of preview.baseline) {
    if (!present.has(section.name)) removed.push({ section, baseline: section, change: 'removed' })
    else if (removed.length > 0) {
      preceding.set(section.name, removed)
      removed = []
    }
  }
  for (const section of preview.sections) {
    const baseline = before.get(section.name)
    const change = !baseline ? 'added' : section.text !== baseline.text ? 'changed' : undefined
    for (const row of preceding.get(section.name) ?? []) rows.push(row)
    rows.push({ section, baseline, change })
  }
  return rows.concat(removed)
}

function SectionTags({ row, t, changes }: { row: Row; t: PromptPresetPreviewProps['t']; changes: boolean }) {
  return <>
    {changes && row.change !== undefined && <Tag tone={CHANGE_TONE[row.change]}>{t(`preview.tag.${row.change}`)}</Tag>}
    {row.section.protectedSection === true && <Tag tone="quiet">{t('preview.tag.protected')}</Tag>}
  </>
}

function SectionText({ row, highlight }: { row: Row; highlight: boolean }) {
  return <PreviewText className={css.text} current={highlight && row.change === 'removed' ? undefined : row.section}
    baseline={row.baseline} highlight={highlight} />
}

function PromptText({ preview, highlight }: { preview: PreviewState; highlight: boolean }) {
  const current = useMemo(() => promptSource(preview.prompt, preview.sections), [preview.prompt, preview.sections])
  const baseline = useMemo(() => highlight ? promptSource(preview.baselinePrompt, preview.baseline) : undefined,
    [highlight, preview.baselinePrompt, preview.baseline])
  return <PreviewText current={current} baseline={baseline} highlight={highlight} className={css.prompt} />
}

/**
 * Render the preview: warnings, then either the section list or the prompt.
 * @param props - the Host's answer, the session state, and localized copy.
 * @returns the pane.
 */
export function PromptPresetPreview({ preview, hasSession, onRefresh, t }: PromptPresetPreviewProps) {
  const [view, setView] = useState<'sections' | 'prompt'>('sections')
  const [layout, setLayout] = useState<'text' | 'grouped'>('text')
  const [highlight, setHighlight] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const { sections, baseline } = preview
  const rows = useMemo(() => sectionRows({ sections, baseline }), [sections, baseline])
  const detail = rows.find(row => row.section.name === selected)
  if (selected !== null && detail === undefined) setSelected(null)
  const groups = highlight ? rows : rows.filter(row => row.change !== 'removed')
  function toggle(name: string) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  if (!hasSession) {
    return (
      <section className={css.root} aria-label={t('preview.heading')}>
        <span className={css.heading}>{t('preview.heading')}</span>
        <p className={css.status}>{t('preview.needsSession')}</p>
      </section>
    )
  }

  return (
    <section className={css.root} aria-label={t('preview.heading')}>
      <header className={css.head}>
        <span className={css.heading}>{t('preview.heading')}</span>
        {/* Status rides the header line, so a redraw never shifts the content below. */}
        {preview.status === 'loading' && <span className={css.status} role="status">{t('preview.loading')}</span>}
        <span className={css.views}>
          <Pill active={view === 'sections'} aria-pressed={view === 'sections'} onClick={() => { setView('sections') }}>
            {t('preview.sections')}
          </Pill>
          <Pill active={view === 'prompt'} aria-pressed={view === 'prompt'} onClick={() => { setView('prompt') }}>
            {t('preview.prompt')}
          </Pill>
          <Tooltip label={t('preview.refresh')} side="top" portal>
            <button type="button" className={css.refresh} aria-label={t('preview.refresh')} onClick={onRefresh}>
              <IconRefreshOutlineRegular size={14} />
            </button>
          </Tooltip>
        </span>
      </header>

      {preview.warnings.length > 0 && (
        <ul className={css.warnings}>
          {preview.warnings.map((warning, index) => (
            <li className={css.warning} role="alert" key={`${warning.code}-${String(index)}`}>
              <IconWarningOutlineRegular size={14} className={css.warningIcon} />
              {t(warningKey(warning.code), {
                position: String((warning.rule ?? 0) + 1),
                section: warning.section ?? '',
                detail: warning.detail ?? '',
              })}
            </li>
          ))}
        </ul>
      )}

      {preview.status === 'error' && (
        <p className={css.error} role="alert">{t('preview.error', { message: preview.error ?? '' })}</p>
      )}

      {view === 'prompt' && (
        <div className={css.controls}>
          <Pill active={layout === 'text'} aria-pressed={layout === 'text'} onClick={() => { setLayout('text') }}>
            {t('preview.textOnly')}
          </Pill>
          <Pill active={layout === 'grouped'} aria-pressed={layout === 'grouped'} onClick={() => { setLayout('grouped') }}>
            {t('preview.grouped')}
          </Pill>
          <Checkbox checked={highlight} onChange={setHighlight} label={t('preview.highlightChanges')} />
        </div>
      )}
      {view === 'prompt' && layout === 'text'
        ? <PromptText preview={preview} highlight={highlight} />
        : <>
          {view === 'prompt' && <div className={css.controls}>
            <Button size="sm" disabled={!groups.some(row => expanded.has(row.section.name))}
              onClick={() => { setExpanded(new Set()) }}>{t('preview.foldAll')}</Button>
            <Button size="sm" disabled={groups.every(row => expanded.has(row.section.name))}
              onClick={() => { setExpanded(new Set(groups.map(row => row.section.name))) }}>{t('preview.unfoldAll')}</Button>
          </div>}
          <ul className={css.sections}>
            {(view === 'sections' ? rows : groups).map((row) => {
              const { section } = row
              const list = view === 'sections'
              const open = !list && expanded.has(section.name)
              return <li className={css.section} key={section.name}>
                <button type="button" className={css.row} aria-haspopup={list ? 'dialog' : undefined}
                  aria-expanded={list ? undefined : open} onClick={(event) => {
                    if (list) {
                      event.currentTarget.focus()
                      setSelected(section.name)
                    } else toggle(section.name)
                  }}>
                  <span className={css.summary}>
                    <span className={css.sectionHead}>
                      <code className={css.sectionName} dir="auto">{section.name}</code>
                      <SectionTags row={row} t={t} changes={list || highlight} />
                    </span>
                    {list && <span className={css.oneLine} dir="auto" aria-hidden="true">{sectionExcerpt(section)}</span>}
                  </span>
                  {open
                    ? <IconChevronDownOutlineRegular size={14} aria-hidden="true" />
                    : <IconChevronRightOutlineRegular className={css.chevron} size={14} aria-hidden="true" />}
                </button>
                {open && <SectionText row={row} highlight={highlight} />}
              </li>
            })}
          </ul>
        </>}
      {detail && <Modal open title={t('preview.detail', { section: detail.section.name })} closeLabel={t('preview.close')}
        className={css.detail as string} contentClassName={css.detailContent as string}
        backdropBlur={false} onClose={() => { setSelected(null) }}>
        <div className={css.controls}>
          <Checkbox checked={highlight} onChange={setHighlight} label={t('preview.highlightChanges')} />
          <SectionTags row={detail} t={t} changes />
        </div>
        <SectionText row={detail} highlight={highlight} />
      </Modal>}
    </section>
  )
}
