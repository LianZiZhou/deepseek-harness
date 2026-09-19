/**
 * The prompt-preset settings page: the roster on the left, one preset's rule
 * stack and its live preview on the right.
 *
 * Edits are staged and written only on save, so the page can refuse a broken
 * rule beside the field rather than after a round trip, and a person can
 * abandon a draft without having stored anything.
 */

import { useEffect, useState } from 'react'
import { Button, Input, Menu, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PromptRule, PromptRuleKind } from '@deepseek-ai/dsh-prompt-presets/types'
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
  discard: () => void
  /** Roster actions. */
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
  const { usePromptPresetSection, load, t } = props
  const state = usePromptPresetSection(value => value)

  useEffect(() => { void load() }, [load])

  if (state.status === 'unavailable') return null

  return (
    <div className={css.root}>
      <h2 className={css.title}>{t('nav')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {state.error !== null && (
        <p className={css.error} role="alert">{t('error', { message: state.error })}</p>
      )}

      <div className={css.columns}>
        <Roster {...props} state={state} />
        <Editor {...props} state={state} />
      </div>

      <CreateDialog {...props} state={state} />
      <SwitchDialog {...props} state={state} />
      <DeleteDialog {...props} state={state} />
    </div>
  )
}

/** Props every internal part shares: the page props plus the read state. */
type PartProps = PromptPresetSectionProps & { state: PromptPresetSectionState }

/** The preset list. */
function Roster({ state, select, beginCreate, setDefault, confirmDelete, t }: PartProps) {
  return (
    <div className={css.rail}>
      <h3 className={css.railHeading}>{t('presetsHeading')}</h3>
      {state.rows.length === 0 && <p className={css.muted}>{t('rosterEmpty')}</p>}
      <ul className={css.rows}>
        {state.rows.map(row => (
          <li className={css.row} key={row.promptPreset}>
            <button
              type="button"
              className={css.rowMain}
              aria-pressed={state.selectedId === row.promptPreset}
              onClick={() => { select(row.promptPreset) }}
            >
              <span className={css.rowName}>{row.name}</span>
              <span className={css.rowMeta}>
                {row.isDefault && <Tag>{t('defaultTag')}</Tag>}
                {row.source === 'deployment' && <Tag>{t('builtIn')}</Tag>}
                <span className={css.muted}>{t('ruleCount', { count: String(row.rules.length) })}</span>
              </span>
            </button>
            <span className={css.rowFoot}>
              {!row.isDefault && (
                <Button
                  size="sm"
                  disabled={state.busy}
                  onClick={() => { void setDefault(row.promptPreset) }}
                >
                  {t('setDefault')}
                </Button>
              )}
              {row.source === 'user' && (
                <Button
                  size="sm"
                  icon={<IconTrashOutline16 />}
                  aria-label={t('deletePreset')}
                  onClick={() => { confirmDelete(row.promptPreset) }}
                />
              )}
            </span>
          </li>
        ))}
      </ul>
      <Button icon={<IconPlusOutline16 />} onClick={beginCreate}>{t('newPreset')}</Button>
    </div>
  )
}

/** The open draft: metadata, rule stack, actions, preview. */
function Editor(props: PartProps) {
  const {
    state, setName, setDescription, addRule, removeRule, moveRule, patchRule, setRuleEnabled,
    save, discard, refreshPreview, hasSession, t,
  } = props
  const draft = state.draft
  if (draft === null) return <p className={css.muted}>{t('editorEmpty')}</p>

  const blocked = draftBlocker(draft)
  const sectionNames = state.preview.baseline.map(section => section.name)

  return (
    <div className={css.editor}>
      <label className={css.field}>
        {t('presetName')}
        <Input
          value={draft.name}
          placeholder={t('presetNamePlaceholder')}
          aria-label={t('presetName')}
          onChange={(event) => { setName(event.target.value) }}
        />
      </label>
      <label className={css.field}>
        {t('presetDescription')}
        <TextArea
          value={draft.description}
          onChange={setDescription}
          ariaLabel={t('presetDescription')}
          placeholder={t('presetDescriptionPlaceholder')}
          rows={2}
          maxRows={4}
        />
      </label>

      <h4 className={css.rulesHeading}>{t('rulesHeading')}</h4>
      {draft.rules.length === 0 && <p className={css.muted}>{t('rulesEmpty')}</p>}
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
      <AddRule kinds={RULE_KINDS} onAdd={addRule} t={t} />

      <div className={css.actions}>
        <Button
          variant="primary"
          disabled={!draft.dirty || state.saving || blocked !== undefined}
          onClick={() => { void save() }}
        >
          {state.saving ? t('saving') : t('save')}
        </Button>
        <Button disabled={!draft.dirty || state.saving} onClick={discard}>{t('discard')}</Button>
        {blocked !== undefined && <span className={css.error} role="alert">{t('saveBlocked')}</span>}
        {state.saveError !== null && (
          <span className={css.error} role="alert">{t('error', { message: state.saveError })}</span>
        )}
      </div>

      <PromptPresetPreview
        preview={state.preview}
        hasSession={hasSession()}
        onRefresh={refreshPreview}
        t={t}
      />
    </div>
  )
}

/** The add-rule menu. */
function AddRule({ kinds, onAdd, t }: {
  kinds: readonly PromptRuleKind[]
  onAdd: (kind: PromptRuleKind) => void
  t: PromptPresetSectionProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      anchor={(
        <Button icon={<IconPlusOutline16 />} onClick={() => { setOpen(true) }}>{t('addRule')}</Button>
      )}
      items={kinds.map(kind => ({ id: kind, label: t(`rule.${kind}.name`) }))}
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
  return (
    <Modal
      open
      onClose={cancelCreate}
      title={t('createTitle')}
      description={t('createIntro')}
      closeLabel={t('cancel')}
      footer={(
        <>
          <Button onClick={cancelCreate}>{t('cancel')}</Button>
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
      <label className={css.field}>
        {t('presetId')}
        <Input
          value={create.id}
          placeholder={t('presetIdPlaceholder')}
          aria-label={t('presetId')}
          aria-invalid={blocker !== undefined}
          onChange={(event) => { patchCreate({ id: event.target.value }) }}
        />
      </label>
      <label className={css.field}>
        {t('displayName')}
        <Input
          value={create.name}
          placeholder={t('displayNamePlaceholder')}
          aria-label={t('displayName')}
          onChange={(event) => { patchCreate({ name: event.target.value }) }}
        />
      </label>
      {blocker !== undefined && (
        <p className={css.error} role="alert">{t(blocker.key as 'idInvalid', blocker.params)}</p>
      )}
      {create.error !== null && (
        <p className={css.error} role="alert">{t('error', { message: create.error })}</p>
      )}
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
          <Button onClick={cancelSwitch}>{t('unsavedKeep')}</Button>
          <Button variant="primary" onClick={confirmSwitch}>{t('unsavedDiscard')}</Button>
        </>
      )}
    />
  )
}

/** The delete confirmation. */
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
          <Button onClick={() => { confirmDelete(null) }}>{t('cancel')}</Button>
          <Button variant="primary" disabled={state.deleting} onClick={() => { void remove() }}>
            {state.deleting ? t('deleting') : t('deleteConfirm')}
          </Button>
        </>
      )}
    />
  )
}
