/**
 * The prompt-preset settings page: one card per preset, in the Models page's
 * list form, where a card opens in place into its rule stack and live preview.
 *
 * Edits are staged and written only on save, so the page can refuse a broken
 * rule beside the field rather than after a round trip, and a person can
 * abandon a draft without having stored anything.
 */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button, IconPlusOutlineRegular, Input, Menu, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PromptPresetRow, PromptRule, PromptRuleKind } from '@deepseek-ai/dsh-prompt-presets/types'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { RULE_KINDS, draftBlocker, isShadowed } from './preset-model.ts'
import { RuleCard } from './RuleCard.tsx'
import { PromptPresetPreview } from './PromptPreview.tsx'
import { TextArea } from './TextArea.tsx'
import type { PromptPresetSectionState } from './section-store.ts'
import css from './PromptPresetSection.module.css'

/** Registration-side business face for the settings section. */
export interface PromptPresetSectionInjected {
  hooks: {
    /** Section state bound by the renderer as usePromptPresetSection. */
    promptPresetSection: SnapshotStore<PromptPresetSectionState>
  }
  /** Read the roster. */
  load: () => Promise<void>
  /** Open one preset in the editor. */
  select: (id: string) => void
  /**
   * Close the editor, asking first when the draft has unsaved edits. Named
   * apart from the settings shell's own `close`, which closes the whole dialog.
   */
  closeEditor: () => void
  /** Resolve the unsaved-changes question. */
  confirmSwitch: () => void
  cancelSwitch: () => void
  /** Create dialog. */
  beginCreate: () => void
  cancelCreate: () => void
  patchCreate: (patch: { id?: string; name?: string }) => void
  confirmCreate: () => Promise<void>
  /** The localized complaint blocking the create dialog, when there is one. */
  createBlocker: () => { key: string; params?: Record<string, string> } | undefined
  /** Editor. */
  setName: (name: string) => void
  setDescription: (description: string) => void
  addRule: (kind: PromptRuleKind) => void
  removeRule: (key: string) => void
  moveRule: (key: string, direction: -1 | 1) => void
  patchRule: (key: string, rule: PromptRule) => void
  setRuleEnabled: (key: string, enabled: boolean) => void
  save: () => Promise<void>
  /** Roster actions; `''` clears the default. */
  setDefault: (id: string) => Promise<void>
  confirmDelete: (id: string | null) => void
  remove: () => Promise<void>
  /** Redraw the preview now. */
  refreshPreview: () => void
  /** Whether a session is open for the preview to run against. */
  hasSession: () => boolean
}

/** Full component props. */
export type PromptPresetSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.promptPreset'>
  & InjectFace<PromptPresetSectionInjected>

/**
 * Render the prompt-preset settings page.
 * @param props - composed slot props.
 * @returns the page, or null when this deployment stores no presets.
 */
export function PromptPresetSection(props: PromptPresetSectionProps) {
  const { usePromptPresetSection, load, beginCreate, t } = props
  const state = usePromptPresetSection(value => value)

  useEffect(() => { void load() }, [load])

  if (state.status === 'unavailable') return null

  const header = (
    <>
      <h2 className={css.title}>{t('nav')}</h2>
      <p className={css.intro}>{t('intro')}</p>
    </>
  )

  // A first read that failed has no roster to keep on screen: the notice and
  // its retry are the page.
  if (state.status === 'error' && state.rows.length === 0) {
    return (
      <section className={css.section}>
        {header}
        <p className={css.error} role="alert">{t('error', { message: state.error ?? '' })}</p>
        <Button variant="outline" className={css.retry} onClick={() => { void load() }}>{t('retry')}</Button>
      </section>
    )
  }

  // Until the first answer, the header alone: a roster that is not known yet
  // is neither empty nor addable.
  if (state.status !== 'ready' && state.rows.length === 0) {
    return <section className={css.section}>{header}</section>
  }

  return (
    <section className={css.section}>
      {header}
      {state.writable ? null : <p className={css.notice}>{t('readOnly')}</p>}
      {state.error !== null && (
        <p className={css.error} role="alert">{t('error', { message: state.error })}</p>
      )}

      {state.rows.length === 0 && !state.writable
        ? <p className={css.muted}>{t('rosterEmpty')}</p>
        : null}
      {state.rows.length === 0
        ? null
        : (
          <ul className={css.rows}>
            {state.rows.map(row => <PresetCard key={row.promptPreset} {...props} state={state} row={row} />)}
          </ul>
        )}
      {state.writable
        ? (
          <button type="button" className={css.addButton} disabled={state.busy} onClick={beginCreate}>
            <IconPlusOutlineRegular size={14} />
            {t('newPreset')}
          </button>
        )
        : null}

      <CreateDialog {...props} state={state} />
      <SwitchDialog {...props} state={state} />
      <DeleteDialog {...props} state={state} />
    </section>
  )
}

/** Props every internal part shares: the page props plus the read state. */
type PartProps = PromptPresetSectionProps & { state: PromptPresetSectionState }

/** One preset: identity, roster actions, and the editor when it is open. */
function PresetCard(props: PartProps & { row: PromptPresetRow }) {
  const { state, row, select, closeEditor, setDefault, confirmDelete, t } = props
  const open = state.selectedId === row.promptPreset && state.draft !== null
  const ruleCount = t('ruleCount', { count: String(row.rules.length) })
  return (
    <li className={css.card}>
      <div className={css.cardHead}>
        <span className={css.identity}>
          <span className={css.name} title={row.name}>{row.name}</span>
          {row.isDefault ? <Tag tone="solid">{t('defaultTag')}</Tag> : null}
          {row.source === 'deployment' ? <Tag tone="outline">{t('builtIn')}</Tag> : null}
        </span>
        <span className={css.cardActions}>
          {state.writable
            ? (
              <Button
                size="sm"
                variant="outline"
                disabled={state.busy}
                onClick={() => { void setDefault(row.isDefault ? '' : row.promptPreset) }}
              >
                {row.isDefault ? t('clearDefault') : t('setDefault')}
              </Button>
            )
            : null}
          <Button
            size="sm"
            variant="outline"
            aria-expanded={open}
            aria-label={`${t('edit')}: ${row.name}`}
            disabled={state.saving}
            onClick={() => { if (open) closeEditor(); else select(row.promptPreset) }}
          >
            {t('edit')}
          </Button>
          {state.writable && row.source === 'user'
            ? (
              <button
                type="button"
                className={css.dangerButton}
                aria-label={`${t('deletePreset')}: ${row.name}`}
                disabled={state.deleting}
                onClick={() => { confirmDelete(row.promptPreset) }}
              >
                {t('deletePreset')}
              </button>
            )
            : null}
        </span>
      </div>
      <p className={css.cardMeta}>
        {row.description === undefined || row.description === '' ? ruleCount : `${row.description} · ${ruleCount}`}
      </p>
      {open ? <Editor {...props} /> : null}
    </li>
  )
}

/** The open draft: metadata, rule stack, preview, actions. */
function Editor(props: PartProps) {
  const {
    state, setName, setDescription, addRule, removeRule, moveRule, patchRule, setRuleEnabled,
    save, closeEditor, refreshPreview, hasSession, t,
  } = props
  const draft = state.draft
  /* v8 ignore next -- PresetCard renders the editor only while a draft is open. */
  if (draft === null) return null

  const blocked = draftBlocker(draft)
  const sectionNames = state.preview.baseline.map(section => section.name)

  return (
    <div className={css.editor}>
      <div className={css.fields}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('presetName')}</span>
          <Input
            value={draft.name}
            placeholder={t('presetNamePlaceholder')}
            aria-label={t('presetName')}
            onChange={(event) => { setName(event.target.value) }}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('presetDescription')}</span>
          <TextArea
            value={draft.description}
            onChange={setDescription}
            ariaLabel={t('presetDescription')}
            placeholder={t('presetDescriptionPlaceholder')}
            rows={2}
            maxRows={4}
          />
        </label>
      </div>

      <div className={css.group}>
        <span className={css.fieldLabel}>{t('rulesHeading')}</span>
        {draft.rules.length === 0 && <p className={css.muted}>{t('rulesEmpty')}</p>}
        {draft.rules.length === 0
          ? null
          : (
            <ul className={css.rules}>
              {draft.rules.map((entry, index) => (
                <RuleCard
                  key={entry.key}
                  entry={entry}
                  position={index + 1}
                  total={draft.rules.length}
                  shadowed={isShadowed(draft.rules, index)}
                  stackBlocker={blocked?.index === index && blocked.blocker.key === 'rule.error.replaceDuplicate'
                    ? blocked.blocker
                    : undefined}
                  disabled={state.saving}
                  sectionNames={sectionNames}
                  onChange={(rule) => { patchRule(entry.key, rule) }}
                  onToggle={(enabled) => { setRuleEnabled(entry.key, enabled) }}
                  onMove={(direction) => { moveRule(entry.key, direction) }}
                  onDelete={() => { removeRule(entry.key) }}
                  t={t}
                />
              ))}
            </ul>
          )}
        <AddRule kinds={RULE_KINDS} disabled={state.saving} onAdd={addRule} t={t} />
      </div>

      <PromptPresetPreview
        preview={state.preview}
        hasSession={hasSession()}
        onRefresh={refreshPreview}
        t={t}
      />

      <div className={css.editorFoot}>
        {blocked !== undefined && <p className={css.error} role="alert">{t('saveBlocked')}</p>}
        {state.saveError !== null && (
          <p className={css.error} role="alert">{t('error', { message: state.saveError })}</p>
        )}
        <span className={css.editorActions}>
          <Button variant="outline" disabled={state.saving} onClick={closeEditor}>{t('cancel')}</Button>
          <Button
            variant="primary"
            disabled={!draft.dirty || state.saving || blocked !== undefined}
            onClick={() => { void save() }}
          >
            {state.saving ? t('saving') : t('save')}
          </Button>
        </span>
      </div>
    </div>
  )
}

/** The add-rule menu, anchored on the Models page's compact add control. */
function AddRule({ kinds, disabled, onAdd, t }: {
  kinds: readonly PromptRuleKind[]
  disabled: boolean
  onAdd: (kind: PromptRuleKind) => void
  t: PromptPresetSectionProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      align="start"
      portal
      anchor={(
        <button
          type="button"
          className={css.addRule}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconPlusOutlineRegular size={14} />
          {t('addRule')}
        </button>
      )}
      items={kinds.map(kind => ({
        id: kind,
        label: (
          <span className={css.menuItem}>
            <span className={css.menuItemName}>{t(`rule.${kind}.name`)}</span>
            <span className={css.menuItemDesc}>{t(`rule.${kind}.hint`)}</span>
          </span>
        ),
      }))}
      onSelect={(id) => {
        onAdd(id as PromptRuleKind)
        setOpen(false)
      }}
      onClose={() => { setOpen(false) }}
    />
  )
}

/** The create dialog. */
function CreateDialog({ state, cancelCreate, patchCreate, confirmCreate, createBlocker, t }: PartProps) {
  const create = state.create
  if (create === null) return null
  const blocker = createBlocker()
  // An empty id is not wrong yet, only unfinished: the field turns red once
  // there is something in it to be wrong about.
  const complaint = create.id === '' ? undefined : blocker
  return (
    <Modal
      open
      onClose={cancelCreate}
      title={t('createTitle')}
      description={t('createIntro')}
      closeLabel={t('cancel')}
      footer={(
        <>
          <Button variant="outline" onClick={cancelCreate}>{t('cancel')}</Button>
          <Button
            variant="primary"
            disabled={create.saving || blocker !== undefined}
            onClick={() => { void confirmCreate() }}
          >
            {create.saving ? t('creating') : t('create')}
          </Button>
        </>
      )}
    >
      <form
        className={css.fields}
        onSubmit={(event) => {
          event.preventDefault()
          if (blocker === undefined) void confirmCreate()
        }}
      >
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('presetId')}</span>
          <Input
            value={create.id}
            placeholder={t('presetIdPlaceholder')}
            aria-label={t('presetId')}
            aria-invalid={complaint !== undefined}
            className={clsx(complaint !== undefined && css.invalid)}
            data-modal-autofocus
            spellCheck={false}
            onChange={(event) => { patchCreate({ id: event.target.value }) }}
          />
          {complaint !== undefined && (
            <span className={css.error} role="alert">{t(complaint.key as 'idInvalid', complaint.params)}</span>
          )}
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('displayName')}</span>
          <Input
            value={create.name}
            placeholder={t('displayNamePlaceholder')}
            aria-label={t('displayName')}
            onChange={(event) => { patchCreate({ name: event.target.value }) }}
          />
        </label>
        {create.error !== null && (
          <p className={css.error} role="alert">{t('error', { message: create.error })}</p>
        )}
        {/* Enter in either field submits; the footer button stays the visible action. */}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

/** The unsaved-changes question. */
function SwitchDialog({ state, confirmSwitch, cancelSwitch, t }: PartProps) {
  if (state.pendingSwitch === null) return null
  return (
    <Modal
      open
      onClose={cancelSwitch}
      title={t('unsavedTitle')}
      description={t('unsavedDescription')}
      closeLabel={t('unsavedKeep')}
      footer={(
        <>
          <Button variant="outline" onClick={cancelSwitch}>{t('unsavedKeep')}</Button>
          <Button variant="outline" className={css.dangerConfirm} onClick={confirmSwitch}>{t('unsavedDiscard')}</Button>
        </>
      )}
    />
  )
}

/** The delete confirmation, worded and colored like the Models page's. */
function DeleteDialog({ state, confirmDelete, remove, t }: PartProps) {
  if (state.pendingDelete === null) return null
  return (
    <Modal
      open
      onClose={() => { confirmDelete(null) }}
      title={t('deleteTitle')}
      description={t('deleteDescription')}
      closeLabel={t('cancel')}
      footer={(
        <>
          <Button variant="outline" onClick={() => { confirmDelete(null) }}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={css.dangerConfirm}
            disabled={state.deleting}
            onClick={() => { void remove() }}
          >
            {state.deleting ? t('deleting') : t('deleteConfirm')}
          </Button>
        </>
      )}
    />
  )
}
