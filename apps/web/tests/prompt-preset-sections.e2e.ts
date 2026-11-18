/** Inspect, edit, and apply named prompt sections in a live task without sending a model request. */
import { fileURLToPath } from 'node:url'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-prompt-presets'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, openSettings } from './support.ts'

const MODE = webSnapshotMode()
const GOLDEN = fileURLToPath(new URL('./expected/prompt-preset-sections/grouped.expected.md', import.meta.url))
const SESSION = brandString<SessionId>('prompt-preset-review')
const PRESET = 'review-notes'
const MODEL = 'deepseek-v4-flash'
const TARGET = 'review:summary'
const SIBLING = 'review:summary:detail'
const PROTECTED = 'tools:ptc-only'
const FOREIGN = 'release:checklist'
const BEFORE = 'Review the draft.'
const AFTER = 'Publish the draft.'
const DETAIL = 'Keep the source citation.'
const OPENING = 'review:opening'
const CLOSING = 'review:closing'
const LITERAL = 'Example: {{model}} = deepseek-v4-flash.'

describe.skipIf(MODE === 'record')('web e2e: prompt preset section editing', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    const { ctx, workspaceCwd } = scaffold
    for (const section of [
      { name: TARGET, order: 450, text: BEFORE },
      { name: SIBLING, order: 451, text: DETAIL },
    ]) ctx.systemPrompt.section(section)
    await ctx.promptPresets.create(PRESET, {
      name: 'Review notes',
      rules: [
        { kind: 'prepend', sectionId: OPENING, text: 'Engine: {{model}} (catalog: deepseek-v4-flash).', interpolate: true },
        { kind: 'append', sectionId: CLOSING, text: LITERAL },
      ],
    })

    const workspace = await ctx.workspaceRegistry.create(workspaceCwd)
    const handle = await ctx.agents.create({
      sessionId: SESSION, meta: { cwd: workspaceCwd, agentPreset: 'ptc' },
      agentOptions: { provider: 'deepseek-official', model: MODEL },
    })
    try {
      await ctx.promptPresets.select(handle.agent, PRESET)
      await workspace.attachSession(SESSION)
    } finally {
      await handle.dispose()
    }

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.addInitScript((id) => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id }))
    }, SESSION)
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: 'Prompt: Review notes', exact: true }).first().waitFor()
    await openSettings(page, 'en')
  })

  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('distinguishes variables from literals and saves a rewrite for exactly one full ID', async () => {
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    const button = (root: Locator, name: string) => root.getByRole('button', { name, exact: true })
    await button(settings, 'Prompt presets').click()
    const edit = button(settings, 'Edit: Review notes')
    await edit.click()
    const preview = settings.getByRole('region', { name: 'Preview' })
    const row = (id: string) => preview.getByRole('listitem').filter({ has: page.getByText(id, { exact: true }) })
    const inspect = async (id: string) => {
      const trigger = row(id).getByRole('button')
      expect(await trigger.getAttribute('aria-expanded')).toBeNull()
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: `Section: ${id}`, exact: true })
      await dialog.waitFor()
      return dialog
    }
    const closeDetail = async (dialog: Locator) => {
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
    }

    const opening = await inspect(OPENING)
    const renderedModel = opening.locator('pre').getByText(MODEL, { exact: true })
    await renderedModel.hover()
    await page.getByRole('tooltip', { name: '{{model}}', exact: true }).waitFor()
    expect(await opening.locator('pre').innerText()).toBe(`Engine: ${MODEL} (catalog: ${MODEL}).`)
    await closeDetail(opening)
    expect(await row(OPENING).locator('pre:visible').count()).toBe(0)

    const literal = await inspect(CLOSING)
    const literalText = literal.locator('pre')
    expect(await literalText.innerText()).toBe(LITERAL)
    expect(await literalText.locator('[tabindex], [title]').count()).toBe(0)
    await closeDetail(literal)

    const save = button(settings, 'Save')
    const prepend = settings.getByRole('listitem', { name: '1. Add before', exact: true })
    const customId = prepend.getByRole('textbox', { name: 'Section ID', exact: true })
    await customId.fill(TARGET)
    await prepend.getByRole('alert').filter({ hasText: TARGET }).waitFor()
    expect(await save.isDisabled()).toBe(true)
    await customId.fill(OPENING)
    await expect.poll(() => save.isEnabled()).toBe(true)

    const addRule = async (kind: string) => {
      await button(settings, 'Add rule').click()
      await page.getByRole('menuitem', { name: new RegExp('^' + kind) }).click()
      return settings.getByRole('listitem', { name: new RegExp('^\\d+\\. ' + kind + '$') })
    }
    const rewrite = await addRule('Edit section')
    const single = rewrite.getByRole('group')
    const filter = single.getByRole('textbox')
    await filter.fill(PROTECTED)
    const protectedOption = single.getByRole('button', { name: new RegExp(PROTECTED) })
    expect(await protectedOption.isDisabled()).toBe(true)
    await filter.fill(TARGET)
    expect(await single.getByRole('button', { name: new RegExp(PROTECTED) }).count()).toBe(0)
    await button(single, TARGET).click()
    await rewrite.getByRole('textbox', { name: 'Text', exact: true }).fill(AFTER)
    await expect.poll(() => row(TARGET).innerText()).toContain(AFTER)

    const remove = await addRule('Remove sections')
    const multi = remove.getByRole('group')
    await multi.getByRole('textbox').fill('deployment:persona-prefix')
    await button(multi, 'deployment:persona-prefix').click()
    await multi.getByRole('textbox').fill(FOREIGN)
    await multi.getByRole('textbox').press('Enter')
    for (const id of ['deployment:persona-prefix', FOREIGN]) {
      expect(await button(multi, id).getAttribute('aria-pressed')).toBe('true')
    }
    await preview.getByRole('alert').filter({ hasText: FOREIGN }).waitFor()

    await button(preview, 'Prompt').click()
    const textOnly = button(preview, 'Text only')
    await textOnly.click()
    const text = await preview.locator('pre').innerText()
    expect(text).toContain(AFTER)
    expect(text).not.toContain(BEFORE)
    expect(text).toContain(LITERAL)

    await button(preview, 'Group by ID').click()
    await button(preview, 'Expand all').click()
    const rows = preview.getByRole('listitem').filter({ has: page.locator('code').filter({ hasText: /^review:/ }) })
    const rendered: string[] = []
    for (const item of await rows.all()) {
      rendered.push(`## ${await item.locator('code').innerText()}\n\n${await item.locator('pre').innerText()}`)
    }
    await compareOrRefreshGolden(GOLDEN, rendered.join('\n\n'), MODE)
    const changed = preview.getByRole('checkbox', { name: 'Show changes' })
    await changed.check()
    expect(await row(TARGET).locator('del').innerText()).toContain('Review')
    expect(await row(TARGET).locator('ins').innerText()).toContain('Publish')
    expect(await row(SIBLING).locator('ins, del').count()).toBe(0)
    await changed.uncheck()
    expect(await row(TARGET).locator('pre').innerText()).toBe(AFTER)
    await button(preview, 'Collapse all').click()
    expect(await preview.locator('pre:visible').count()).toBe(0)
    expect(await rows.locator('code').allInnerTexts()).toEqual([OPENING, TARGET, SIBLING, CLOSING])

    await textOnly.click()
    expect(await preview.locator('pre').innerText()).toBe(text)

    await save.click()
    await expect.poll(() => edit.getAttribute('aria-expanded')).toBe('false')
    const stored = scaffold.ctx.promptPresets.list().presets.find(preset => preset.promptPreset === PRESET)
    expect(stored?.rules.slice(2)).toMatchObject([
      { kind: 'rewrite', section: TARGET, text: AFTER },
      { kind: 'remove', sections: ['deployment:persona-prefix', FOREIGN] },
    ])
    const agent = scaffold.ctx.agents.get(SESSION)
    if (!agent) throw new Error('The edited session is no longer active')
    const assembly = await scaffold.ctx.systemPrompt.assemble({ ...assembleContextFor(agent), preview: true })
    expect(assembly.sections.filter(section => section.name === TARGET || section.name === SIBLING)
      .map(({ name, text }) => [name, text])).toEqual([[TARGET, AFTER], [SIBLING, DETAIL]])
    expect(assembly.sections.find(section => section.name === PROTECTED)?.text).toContain('run_code')
    expect(assembly.sections.some(section => section.name === 'deployment:persona-prefix')).toBe(false)
    expect(tripwire).toEqual({ warnings: [], pageErrors: [] })
  })
})
