/**
 * The Models page's sign-in rows: one per flow this composition offers.
 *
 * A provider whose credential is obtained by talking to the human — an OAuth
 * grant, a code minted in a browser — cannot be configured by typing a key into
 * the card above, so it gets a row of its own here. The row is the whole
 * conversation: the button that starts it, the page the flow asks the human to
 * open, the question it asks about what they found there, and how it ended.
 *
 * Rendering nothing is the correct output for a composition that offers no
 * sign-in, which is why the section disappears rather than showing an empty
 * state: the page has nothing to say about a capability it does not have.
 *
 * @module dsh-client-ui-settings-models/client/SignInSection
 */

import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import type { AuthorizationEntryView } from '@deepseek-ai/dsh-api-settings-controller/types'
import type { SignInAttempt, SignInStore } from './sign-in-store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link SignInSection}. */
export interface SignInSectionProps {
  /** The page's sign-in controller. */
  controller: SignInStore
  /** Localizer for this section's copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Whether a flow belongs in this section at all.
 *
 * Every provider that collects a key interactively registers a flow, and for
 * those the flow is the key field the card above already shows — a row here
 * would ask for the same secret twice. A row earns its place only when the
 * flow offers something the field cannot do: a conversation the human has to
 * leave the page for.
 * @param flow - one registered flow.
 * @returns whether to render a row for it.
 */
function isSignIn(flow: AuthorizationEntryView): boolean {
  return flow.methods.some(method => method.id !== 'api-key')
}

/** Substitute the one placeholder this section's copy uses. */
function withFlow(template: string, label: string): string {
  return template.replace('{provider}', label)
}

/**
 * Render one flow's open question.
 * @param props - the flow, its live state, the controller, and the localizer.
 * @returns the question's input and its two actions.
 */
function Question(props: {
  flow: AuthorizationEntryView
  state: SignInAttempt
  controller: SignInStore
  t: (key: keyof typeof en) => string
}): ReactNode {
  const { controller, flow, state, t } = props
  const prompt = state.prompt
  if (prompt === undefined) return null
  const answer = (value: string): void => { void controller.answer(flow.key, value) }
  return (
    <div className={styles['field']}>
      <label className={styles['fieldLabel']} htmlFor={`sign-in-${prompt.prompt}`}>{prompt.message}</label>
      {prompt.kind === 'select'
        ? (
          <div className={styles['candidateActions']}>
            {(prompt.options ?? []).map(option => (
              <button
                key={option.id}
                type="button"
                className={styles['secondaryButton']}
                title={option.description}
                onClick={() => { answer(option.id) }}
              >
                {option.label}
              </button>
            ))}
          </div>
        )
        : (
          <div className={styles['rowActions']}>
            <input
              id={`sign-in-${prompt.prompt}`}
              className={styles['input']}
              type={prompt.kind === 'secret' ? 'password' : 'text'}
              autoComplete="off"
              placeholder={prompt.placeholder ?? ''}
              value={state.draft}
              onChange={(event) => { controller.type(flow.key, event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && state.draft.length > 0) answer(state.draft)
              }}
            />
            <button
              type="button"
              className={styles['primaryButton']}
              disabled={state.draft.length === 0}
              onClick={() => { answer(state.draft) }}
            >
              {t('signInSubmit')}
            </button>
          </div>
        )}
      <button
        type="button"
        className={styles['linkButton']}
        onClick={() => { void controller.decline(flow.key) }}
      >
        {t('cancel')}
      </button>
    </div>
  )
}

/**
 * Render one flow's row.
 * @param props - the flow, its live state, the controller, and the localizer.
 * @returns the row.
 */
function SignInRow(props: {
  flow: AuthorizationEntryView
  state: SignInAttempt
  controller: SignInStore
  t: (key: keyof typeof en) => string
}): ReactNode {
  const { controller, flow, state, t } = props
  const running = state.busy || state.prompt !== undefined
  return (
    <div className={styles['rowCard']}>
      <div className={styles['rowHead']}>
        <div className={styles['rowIdentity']}>
          <span className={styles['rowName']}>{flow.label}</span>
          <span className={styles['rowTag']}>{flow.key}</span>
        </div>
        <div className={styles['rowActions']}>
          {running
            ? (
              <button
                type="button"
                className={styles['secondaryButton']}
                onClick={() => { void controller.cancel(flow.key) }}
              >
                {t('signInCancel')}
              </button>
            )
            : flow.methods.map(method => (
              <button
                key={method.id}
                type="button"
                className={styles['secondaryButton']}
                disabled={flow.inFlight}
                onClick={() => { void controller.begin(flow.key, method.id) }}
              >
                {method.label}
              </button>
            ))}
        </div>
      </div>
      {state.notices.map((notice, index) => (
        <p key={`${notice.attempt}-${index}`} className={styles['notice']}>
          {notice.message}
          {notice.url === undefined
            ? null
            : (
              <>
                {' '}
                <a className={styles['linkButton']} href={notice.url} target="_blank" rel="noreferrer noopener">
                  {t('signInOpenPage')}
                </a>
              </>
            )}
          {notice.code === undefined ? null : <> <code>{notice.code}</code></>}
        </p>
      ))}
      <Question flow={flow} state={state} controller={controller} t={t} />
      {state.outcome === undefined
        ? null
        : (
          <p className={styles['savedNotice']}>
            {withFlow(state.outcome === 'authorized' ? t('signInDone') : t('signInCancelled'), flow.label)}
          </p>
        )}
      {state.error === undefined ? null : <p className={styles['error']}>{state.error}</p>}
    </div>
  )
}

/**
 * Render every sign-in this composition offers.
 * @param props - the controller and the localizer.
 * @returns the section, or nothing when no flow is registered.
 */
export function SignInSection(props: SignInSectionProps): ReactNode {
  const { controller, t } = props
  const store = controller.store
  const state = useSyncExternalStore(
    listener => store.subscribe(listener),
    () => store.getSnapshot(),
  )
  // The section's own first read, on its own store: the page snapshot has
  // usually loaded before this section ever mounts, so hanging the read off
  // that snapshot's idle state would leave it unread forever.
  if (state.status === 'idle') void controller.load()
  const flows = state.flows.filter(isSignIn)
  if (flows.length === 0 && state.error === undefined) return null
  return (
    <div className={styles['section']}>
      <h3 className={styles['modelCatalogTitle']}>{t('signInTitle')}</h3>
      <p className={styles['intro']}>{t('signInIntro')}</p>
      {state.error === undefined
        ? null
        : <p className={styles['error']}>{`${t('signInLoadFailed')}: ${state.error}`}</p>}
      <div className={styles['rows']}>
        {flows.map(flow => (
          <SignInRow
            key={flow.key}
            flow={flow}
            state={state.attempts[flow.key] ?? { notices: [], draft: '', busy: false }}
            controller={controller}
            t={t}
          />
        ))}
      </div>
    </div>
  )
}
