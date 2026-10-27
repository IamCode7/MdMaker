import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { type ElectronApplication, type Page, _electron as electron, expect, test } from '@playwright/test'

/** 실제 앱을 띄운다. 저장·PDF 창 대신 임시 폴더에 바로 저장하는 테스트 모드로 연다. */
async function launch(): Promise<{ app: ElectronApplication; page: Page; dir: string; errors: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'mdeditor-e2e-'))
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js')],
    env: { ...process.env, MDEDITOR_TEST_DIR: dir }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.locator('.cm-content').waitFor()
  return { app, page, dir, errors }
}

const setText = (page: Page, text: string) =>
  page.evaluate((value) => {
    const { view } = (window as any).__md
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, text)

const getText = (page: Page) => page.evaluate(() => (window as any).__md.view.state.doc.toString() as string)
const run = (page: Page, command: string) => page.evaluate((name) => (window as any).__md.run(name), command)

/** 테스트용 작은 PNG (1×1 주황색 점) */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwAI/AL+hc2rNAAAAABJRU5ErkJggg==',
  'base64'
)

test('시작하면 무제 탭 하나와 편집기가 보이고, 입력한 MD를 그 자리에서 꾸민다', async () => {
  const { app, page, errors } = await launch()
  await expect(page.locator('.tab')).toHaveText(['무제×'])

  await page.locator('.cm-content').click()
  await page.keyboard.type('# 제목\n\n**굵게** 와 `코드` 그리고 ~~취소~~')
  await expect(page.locator('.md-h1').first()).toBeVisible()
  await expect(page.locator('.md-strong').first()).toBeVisible()
  await expect(page.locator('.md-code').first()).toBeVisible()
  await expect(page.locator('.md-strike').first()).toBeVisible()
  // 커서가 닿은 요소(맨 끝 취소선)만 기호를 흐리게 보여주고, 나머지 # · ** · ` 는 숨긴다
  const lines = page.locator('.cm-line')
  await expect(page.locator('.md-mark').first()).toBeVisible()
  await expect(lines.nth(0)).toHaveText('제목')
  await expect(lines.nth(2)).toHaveText('굵게 와 코드 그리고 ~~취소~~')
  // 커서를 굵게 안으로 옮기면 그 기호만 다시 보인다
  await page.evaluate(() => (window as any).__md.view.dispatch({ selection: { anchor: '# 제목\n\n**굵'.length } }))
  await expect(lines.nth(0)).toHaveText('제목')
  await expect(lines.nth(2)).toHaveText('**굵게** 와 코드 그리고 취소')
  await expect(page.locator('.tab.dirty')).toHaveCount(1)
  expect(errors).toEqual([])
  await app.close()
})

test('코드 블록·콜아웃·수평선이 많아도 클릭한 줄에 커서가 가고, 수평선을 지울 수 있다', async () => {
  const { app, page } = await launch()
  const parts: string[] = []
  for (let i = 1; i <= 6; i++) parts.push(`## 제목${i}`, `문단${i} 글자`, '```js\nlet a = 1\n```', '> [!NOTE]\n> 참고', '---', `끝${i} 표시`)
  await setText(page, parts.join('\n\n'))
  const cursorLine = () =>
    page.evaluate(() => {
      const { view } = (window as any).__md
      return view.state.doc.lineAt(view.state.selection.main.head).text as string
    })
  for (const word of ['문단1', '끝3', '문단5', '끝6']) {
    await page.locator('.cm-line', { hasText: word }).first().click({ position: { x: 30, y: 8 } })
    expect(await cursorLine()).toContain(word)
  }

  // 세 번째 수평선 줄을 클릭해서 지운다.
  await page.locator('.cm-hr').nth(2).click({ position: { x: 20, y: 8 } })
  expect(await cursorLine()).toBe('---')
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('Backspace')
  expect((await getText(page)).match(/^---$/gm)?.length).toBe(5)
  await app.close()
})

test('서식 단축키와 목록 이어쓰기', async () => {
  const { app, page } = await launch()
  await setText(page, '굵게')
  await page.evaluate(() => (window as any).__md.view.dispatch({ selection: { anchor: 0, head: 2 } }))
  await run(page, 'bold')
  expect(await getText(page)).toBe('**굵게**')
  await run(page, 'bold')
  expect(await getText(page)).toBe('굵게')

  await setText(page, '- 사과')
  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('배')
  expect(await getText(page)).toBe('- 사과\n- 배')
  await app.close()
})

test('+ 버튼으로 탭을 만들고, 저장하면 파일에 써진다', async () => {
  const { app, page, dir } = await launch()
  await page.locator('#new-tab').click()
  await expect(page.locator('.tab-title')).toHaveText(['무제', '무제 2'])

  await setText(page, '# 저장 테스트')
  await run(page, 'save') // 새 문서라 "다른 이름으로 저장" → 테스트 폴더
  expect(readFileSync(join(dir, '무제 2.md'), 'utf8')).toBe('# 저장 테스트')
  await expect(page.locator('.tab-title')).toHaveText(['무제', '무제 2.md'])
  await expect(page.locator('.tab.dirty')).toHaveCount(0)

  await setText(page, '# 고친 내용')
  await expect(page.locator('.tab.dirty')).toHaveCount(1)
  await run(page, 'save') // 이제 같은 파일에 덮어쓴다
  expect(readFileSync(join(dir, '무제 2.md'), 'utf8')).toBe('# 고친 내용')
  await app.close()
})

test('``` 뒤 언어 목록, mermaid → 다이어그램 종류 → 기본 문법', async () => {
  const { app, page } = await launch()
  await page.locator('.cm-content').click()
  await page.keyboard.type('```s')
  const list = page.locator('.cm-tooltip-autocomplete li')
  await expect(list).toHaveText(['scala', 'scss', 'shell', 'sql', 'swift'])
  await page.keyboard.press('Escape')

  await setText(page, '')
  await page.keyboard.type('```me')
  await expect(list).toHaveText(['mermaid›'])
  await page.keyboard.press('ArrowRight')
  await expect(list.first()).toHaveText('무제 (빈 다이어그램)')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  expect(await getText(page)).toBe(
    '```mermaid\nflowchart TD\n    A[시작] --> B{조건}\n    B -->|예| C[처리]\n    B -->|아니오| D[종료]\n```'
  )
  await expect(page.locator('.cm-preview-mermaid[data-state="ok"] svg')).toBeVisible({ timeout: 10_000 })
  await app.close()
})

test('표·이미지·다이어그램을 아래에 그리고, 체크박스를 클릭하면 체크된다', async () => {
  const { app, page, dir, errors } = await launch()
  writeFileSync(join(dir, '점.png'), PNG)
  const content = [
    '- [ ] 할 일',
    '',
    '| 이름 | 나이 |',
    '|---|---|',
    '| 철수 | 20 |',
    '',
    '![점](점.png)',
    '',
    '```mermaid',
    'pie title 비율',
    '    "A" : 60',
    '    "B" : 40',
    '```',
    '',
    '```mermaid',
    'flowchart TD',
    '    A -->',
    '```'
  ].join('\n')
  // 파일 더블클릭으로 연 것처럼 메인에서 보낸다. (문서 폴더 기준으로 이미지를 찾는다)
  await app.evaluate(({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].webContents.send('open-file', file), {
    path: join(dir, '노트.md'),
    content
  })
  await expect(page.locator('.tab-title')).toHaveText(['노트.md'])
  await expect
    .poll(() => page.evaluate(() => (window as any).__md.previewStates()), { timeout: 15_000 })
    .toEqual(['ok', 'ok', 'ok', 'error'])
  await expect(page.locator('.cm-preview-table th').first()).toHaveText('이름')
  await expect(page.locator('.cm-preview-error')).toContainText('Mermaid 문법 오류')

  await page.locator('.cm-task').first().click()
  expect((await getText(page)).startsWith('- [x] 할 일')).toBe(true)
  expect(errors).toEqual([])
  await app.close()
})

test('⌘/Ctrl + 클릭으로 링크를 연다', async () => {
  const { app, page, dir } = await launch()
  await setText(page, '[애플](https://www.apple.com) 그리고 https://example.com')
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.locator('.md-link', { hasText: '애플' }).first().click({ modifiers: [modifier] })
  await page.locator('.cm-bare-url').first().click({ modifiers: [modifier] })
  await expect.poll(() => (existsSync(join(dir, 'opened-urls.txt')) ? readFileSync(join(dir, 'opened-urls.txt'), 'utf8') : '')).toBe(
    'https://www.apple.com\nhttps://example.com\n'
  )
  await app.close()
})

test('PDF로 내보내기', async () => {
  const { app, page, dir } = await launch()
  await setText(page, '# 제목\n\n본문 **굵게**\n\n> [!NOTE]\n> 참고\n\n```mermaid\nflowchart LR\n    A --> B\n```\n')
  await run(page, 'exportPDF')
  const pdf = readFileSync(join(dir, '무제.pdf'))
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.length).toBeGreaterThan(5_000)
  await app.close()
})

/** PDF 파일의 쪽 수 */
const pdfPageCount = (pdf: Buffer): number => {
  const match = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/.exec(pdf.toString('latin1'))
  return match ? Number(match[1]) : -1
}

test('> 버튼으로 PDF 미리보기를 열면 창이 넓어지고, 입력한 대로 바로 바뀌며, < 로 닫는다', async () => {
  const { app, page } = await launch()
  const button = page.locator('#toggle-preview')
  const windowWidth = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width)
  await expect(button).toHaveText('>')
  await expect(page.locator('#preview')).toBeHidden()
  const before = await windowWidth()

  await button.click()
  await expect(button).toHaveText('<')
  await expect(page.locator('#preview')).toBeVisible()
  await expect.poll(windowWidth).toBeGreaterThan(before)

  await page.locator('.cm-content').click()
  await page.keyboard.type('# 미리보기 제목\n\n**굵은** 글자와 `코드`')
  await expect.poll(() => page.evaluate(() => (window as any).__md.pdfPreviewText() as string)).toContain('미리보기 제목')
  const text: string = await page.evaluate(() => (window as any).__md.pdfPreviewText())
  expect(text).toContain('굵은 글자와 코드')
  expect(text).not.toContain('**')
  expect(text).not.toContain('#')

  await button.click()
  await expect(button).toHaveText('>')
  await expect(page.locator('#preview')).toBeHidden()
  await expect.poll(windowWidth).toBe(before)
  await app.close()
})

for (const [name, content] of [
  ['짧은 문단만', Array.from({ length: 150 }, (_, i) => `${i + 1}번째 문단입니다. 쪽 나눔 위치를 확인합니다.`).join('\n\n')],
  [
    '제목·코드 블록·콜아웃·표가 섞인 문서',
    Array.from({ length: 14 }, (_, i) =>
      [
        `## ${i + 1}장`,
        '본문 문장입니다. '.repeat(12),
        '```swift\nlet a = 1\nlet b = 2\nlet c = 3\nprint(a + b + c)\n```',
        '> [!NOTE]\n> 참고할 내용입니다.',
        '| 이름 | 값 |\n|---|---|\n| 가 | 1 |\n| 나 | 2 |'
      ].join('\n\n')
    ).join('\n\n')
  ]
] as const) {
  test(`미리보기의 쪽 수가 실제 PDF와 같다 (${name})`, async () => {
    const { app, page, dir } = await launch()
    await page.locator('#toggle-preview').click()
    await setText(page, content)
    await expect.poll(() => page.evaluate(() => (window as any).__md.pdfPreviewPages() as number)).toBeGreaterThan(1)
    await page.waitForTimeout(500)
    const previewPages: number = await page.evaluate(() => (window as any).__md.pdfPreviewPages())
    await run(page, 'exportPDF')
    expect(previewPages).toBe(pdfPageCount(readFileSync(join(dir, '무제.pdf'))))
    await app.close()
  })
}
