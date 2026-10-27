import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { type ElectronApplication, type Page, _electron as electron, expect, test } from '@playwright/test'
import { formatAccelerator } from '../../src/shared/shortcuts'

/** 실제 앱을 띄운다. 저장·PDF 창 대신 임시 폴더에 바로 저장하는 테스트 모드로 연다. */
async function launch(dir = mkdtempSync(join(tmpdir(), 'mdeditor-e2e-'))): Promise<{ app: ElectronApplication; page: Page; dir: string; errors: string[] }> {
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

/** 실제 보기 메뉴를 눌러 메인 → 화면 명령 전달까지 확인한다. */
const clickViewMenu = (app: ElectronApplication, label: string) =>
  app.evaluate(({ Menu }, name) => {
    const item = Menu.getApplicationMenu()!.items.find((item) => item.label === '보기')!
      .submenu!.items.find((item) => item.label === name)!
    item.click()
  }, label)

test('보기 메뉴로 글씨를 1px씩 조절하고, 한계·기본 크기·제목 비율을 유지한다', async () => {
  const { app, page, errors } = await launch()
  try {
    const menuItems = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.find((item) => item.label === '보기')!.submenu!.items
        .filter((item) => item.accelerator).map((item) => [item.label, item.accelerator])
    )
    expect(menuItems).toEqual(expect.arrayContaining([
      ['글씨 크게', 'CmdOrCtrl+='], ['글씨 작게', 'CmdOrCtrl+-'], ['기본 크기', 'CmdOrCtrl+0']
    ]))
    const content = '# 제목\n\n한글 본문\n\n```ts\nconst a = 1\n```'
    await setText(page, content)
    const editor = page.locator('.cm-content')
    await expect(editor).toHaveCSS('font-size', '15px')
    await clickViewMenu(app, '글씨 크게')
    await expect(editor).toHaveCSS('font-size', '16px')
    await expect(page.locator('.md-h1').first()).toHaveCSS('font-size', '29.6px')
    await clickViewMenu(app, '글씨 작게')
    await expect(editor).toHaveCSS('font-size', '15px')
    for (let i = 0; i < 20; i++) await clickViewMenu(app, '글씨 크게')
    await expect(editor).toHaveCSS('font-size', '24px')
    await expect(page.locator('.cm-codeblock').first()).toHaveCSS('font-size', '22.4px')
    await run(page, 'new')
    await expect(editor).toHaveCSS('font-size', '24px')
    await run(page, 'previousTab')
    expect(await getText(page)).toBe(content)
    for (let i = 0; i < 20; i++) await clickViewMenu(app, '글씨 작게')
    await expect(editor).toHaveCSS('font-size', '11px')
    await clickViewMenu(app, '기본 크기')
    await expect(editor).toHaveCSS('font-size', '15px')
    expect(await getText(page)).toBe(content)
    // 실제 입력 조합 이벤트를 보내 조합 중 크기 변경으로 글자가 사라지지 않는지 확인한다.
    await run(page, 'new')
    await editor.click()
    const session = await page.context().newCDPSession(page)
    await session.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 })
    await clickViewMenu(app, '글씨 크게')
    await expect(editor).toHaveCSS('font-size', '16px')
    await session.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
    await session.send('Input.insertText', { text: '한' })
    await session.send('Input.insertText', { text: '글' })
    expect(await getText(page)).toBe('한글')
    await session.detach()
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('글씨 크기를 앱 재시작 뒤 복원하고 잘못된 저장값은 기본 크기로 연다', async () => {
  const first = await launch()
  try {
    await clickViewMenu(first.app, '글씨 크게')
    await expect(first.page.locator('.cm-content')).toHaveCSS('font-size', '16px')
    expect(first.errors).toEqual([])
  } finally {
    await first.app.close()
  }
  const { app, page, errors } = await launch(first.dir)
  try {
    await expect(page.locator('.cm-content')).toHaveCSS('font-size', '16px')
    for (const value of ['잘못된 값', '10', '25', '15.5', '']) {
      await page.evaluate((saved) => localStorage.setItem('editor-font-size', saved), value)
      await page.reload()
      await expect(page.locator('.cm-content')).toHaveCSS('font-size', '15px')
    }
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('편집기 글씨 크기를 바꿔도 PDF 미리보기와 내보내기 크기는 같다', async () => {
  const { app, page, dir, errors } = await launch()
  try {
    await setText(page, '# 제목\n\n' + '한글 본문과 PDF 크기를 확인합니다.\n\n'.repeat(60))
    await run(page, 'togglePreview')
    const previewBody = page.frameLocator('#preview iframe').locator('body')
    await expect(previewBody).toContainText('한글 본문')
    const beforePreview = await previewBody.evaluate((body) => ({
      size: getComputedStyle(body).fontSize,
      titleSize: getComputedStyle(body.querySelector('h1')!).fontSize,
      height: body.getBoundingClientRect().height
    }))
    await run(page, 'exportPDF')
    const beforePDF = readFileSync(join(dir, '무제.pdf'))
    for (let i = 0; i < 12; i++) await clickViewMenu(app, '글씨 크게')
    await expect(page.locator('.cm-content')).toHaveCSS('font-size', '24px')
    expect(await previewBody.evaluate((body) => ({
      size: getComputedStyle(body).fontSize,
      titleSize: getComputedStyle(body.querySelector('h1')!).fontSize,
      height: body.getBoundingClientRect().height
    }))).toEqual(beforePreview)
    await run(page, 'exportPDF')
    const afterPDF = readFileSync(join(dir, '무제.pdf'))
    // 생성 시각 같은 메타데이터를 제외한 PDF 내용 스트림이 같아야 한다.
    const streams = (pdf: Buffer) => [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => match[1])
    expect(streams(beforePDF).length).toBeGreaterThan(0)
    expect(streams(afterPDF)).toEqual(streams(beforePDF))
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

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

/** 메뉴 전체에서 이름 → 단축키 */
const menuAcceleratorsByLabel = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => {
    const result: Record<string, string> = {}
    const walk = (items: Electron.MenuItem[]) => {
      for (const item of items) {
        if (item.accelerator) result[item.label] = String(item.accelerator)
        if (item.submenu) walk(item.submenu.items)
      }
    }
    walk(Menu.getApplicationMenu()!.items)
    return result
  })

const windowWidthOf = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width)

test('왼쪽 위 < 버튼·메뉴로 문법 창을 열고 닫으며, 단축키는 메뉴와 같은 글자로 OS에 맞게 보인다', async () => {
  const { app, page, errors } = await launch()
  try {
    const isMac = await app.evaluate(() => process.platform === 'darwin')
    const menu = await menuAcceleratorsByLabel(app)
    expect(menu['문법 창 보기/숨기기']).toBe('CmdOrCtrl+Alt+L')
    expect(menu['원문 보기 켜기/끄기']).toBe('CmdOrCtrl+/')

    const button = page.locator('#toggle-syntax')
    const panel = page.locator('#syntax-panel')
    await expect(button).toHaveText('<')
    await expect(panel).toBeHidden()
    const before = await windowWidthOf(app)
    const editorBefore = await page.locator('#editor').evaluate((element) => element.clientWidth)

    await button.click()
    await expect(button).toHaveText('>')
    await expect(panel).toBeVisible()
    // 창을 넓혀서 편집 화면 폭이 그대로 남는다
    await expect.poll(() => windowWidthOf(app)).toBeGreaterThan(before)
    await expect.poll(() => page.locator('#editor').evaluate((element) => element.clientWidth)).toBe(editorBefore)
    for (const word of ['제목 (밑줄식)', '**굵게**', '![설명](그림.png)', '- [ ] 할 일', '> [!NOTE]', 'CAUTION', '[^1]', '|:---|---:|', '```mermaid', '<details>', '수평선', 'title: 문서 제목']) {
      await expect(panel).toContainText(word)
    }

    // 문법 창의 단축키 = 실제 메뉴 단축키를 OS 모양으로 바꾼 것
    const rows: Record<string, string[]> = {
      '굵게 / 기울임': ['굵게', '기울임'],
      '취소선 / 코드': ['취소선', '코드'],
      '링크': ['링크'],
      '저장 / 다른 이름으로': ['저장', '다른 이름으로 저장…'],
      '새 탭 / 탭 닫기': ['새 탭', '탭 닫기'],
      '다음 탭 / 이전 탭': ['다음 탭', '이전 탭'],
      'PDF 미리보기': ['PDF 미리보기 보기/숨기기'],
      'PDF로 내보내기': ['PDF로 내보내기…'],
      '글씨 크게 / 작게': ['글씨 크게', '글씨 작게'],
      '글씨 기본 크기': ['기본 크기'],
      '문법 창': ['문법 창 보기/숨기기'],
      '원문 보기': ['원문 보기 켜기/끄기']
    }
    const shown = await page.locator('.syntax-shortcuts tr').evaluateAll((trs) =>
      Object.fromEntries(trs.map((tr) => [tr.querySelector('td')!.textContent, Array.from(tr.querySelectorAll('kbd'), (kbd) => kbd.textContent)]))
    )
    expect(shown).toEqual(
      Object.fromEntries(Object.entries(rows).map(([name, labels]) => [name, labels.map((label) => formatAccelerator(menu[label], isMac))]))
    )
    await expect(page.locator('.syntax-shortcuts')).toContainText(isMac ? '⌥⌘L' : 'Ctrl+Alt+L')
    await expect(page.locator('.syntax-shortcuts')).not.toContainText(isMac ? 'Ctrl' : '⌘')

    // 다크 모드에서도 창 색이 바뀐다
    const background = () => panel.evaluate((element) => getComputedStyle(element).backgroundColor)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(background).toBe('rgb(22, 22, 22)')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(background).toBe('rgb(236, 236, 238)')

    await clickViewMenu(app, '문법 창 보기/숨기기')
    await expect(button).toHaveText('<')
    await expect(panel).toBeHidden()
    await expect.poll(() => windowWidthOf(app)).toBe(before)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('문법 창의 열림 상태와 폭을 앱 재시작 뒤에도 기억한다', async () => {
  const first = await launch()
  try {
    await first.page.locator('#toggle-syntax').click()
    const divider = (await first.page.locator('#syntax-divider').boundingBox())!
    await first.page.mouse.move(divider.x + 3, divider.y + 100)
    await first.page.mouse.down()
    await first.page.mouse.move(divider.x + 3 + 80, divider.y + 100, { steps: 5 })
    await first.page.mouse.up()
    await expect(first.page.locator('#syntax-panel')).toHaveCSS('width', '380px')
    expect(first.errors).toEqual([])
  } finally {
    await first.app.close()
  }
  const { app, page, errors } = await launch(first.dir)
  try {
    await expect(page.locator('#syntax-panel')).toBeVisible()
    await expect(page.locator('#syntax-panel')).toHaveCSS('width', '380px')
    await expect(page.locator('#toggle-syntax')).toHaveText('>')
    await page.locator('#toggle-syntax').click()
    await expect(page.locator('#syntax-panel')).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('syntax-panel-open'))).toBe('0')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('MD 버튼·메뉴로 원문 보기를 켜면 꾸밈 없이 원문이 보이고, PDF 미리보기는 그대로이며 모든 탭에 적용된다', async () => {
  const { app, page, errors } = await launch()
  try {
    const content = '# 제목\n\n**굵게** 와 `코드`\n\n| 이름 | 나이 |\n|---|---|\n| 철수 | 20 |\n\n```mermaid\nflowchart TD\n    A --> B\n```\n\n끝'
    await setText(page, content)
    await page.evaluate(() => (window as any).__md.view.dispatch({ selection: { anchor: (window as any).__md.view.state.doc.length } }))
    const lines = page.locator('.cm-line')
    const button = page.locator('#toggle-source')
    await expect(lines.nth(0)).toHaveText('제목')
    await expect(page.locator('.cm-preview')).toHaveCount(2)
    await run(page, 'togglePreview')
    await expect.poll(() => page.evaluate(() => (window as any).__md.pdfPreviewText() as string)).toContain('굵게 와 코드')

    await button.click()
    await expect(button).toHaveClass(/active/)
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(lines.nth(0)).toHaveText('# 제목')
    await expect(lines.nth(2)).toHaveText('**굵게** 와 `코드`')
    for (const selector of ['.md-h1', '.md-strong', '.md-mark', '.cm-preview', '.cm-codeblock', '.tok-keyword']) {
      await expect(page.locator(selector)).toHaveCount(0)
    }
    expect(await getText(page)).toBe(content)
    // PDF 미리보기는 원문 보기와 상관없이 꾸민 결과
    await setText(page, content + '\n\n**추가**')
    await expect.poll(() => page.evaluate(() => (window as any).__md.pdfPreviewText() as string)).toContain('추가')
    expect(await page.evaluate(() => (window as any).__md.pdfPreviewText() as string)).not.toContain('**')
    await setText(page, content)

    // 새 탭과 다른 탭도 같은 상태
    await run(page, 'new')
    await setText(page, '## 둘째')
    await expect(lines.nth(0)).toHaveText('## 둘째')
    await expect(page.locator('.md-h2')).toHaveCount(0)
    await run(page, 'previousTab')
    await expect(lines.nth(0)).toHaveText('# 제목')

    await clickViewMenu(app, '원문 보기 켜기/끄기')
    await expect(button).not.toHaveClass(/active/)
    await expect(page.locator('.md-h1').first()).toBeVisible()
    await expect(page.locator('.cm-preview')).toHaveCount(2)
    await run(page, 'nextTab')
    await expect(page.locator('.md-h2').first()).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('편집기에서 ⌘/(Ctrl+/)를 눌러도 주석이 들어가지 않고, 한글 조합 중에 원문 보기를 바꿔도 글자가 깨지지 않는다', async () => {
  const { app, page, errors } = await launch()
  try {
    await setText(page, '**굵게**')
    const editor = page.locator('.cm-content')
    await editor.click()
    // 편집기가 ⌘/ 를 먹지 않아야(preventDefault 안 함) Electron이 메뉴의 원문 보기 단축키로 넘긴다.
    await page.evaluate(() =>
      window.addEventListener('keydown', (event) => {
        if (event.key === '/') (window as any).__slashHandled = event.defaultPrevented
      })
    )
    await page.keyboard.press('ControlOrMeta+/')
    expect(await page.evaluate(() => (window as any).__slashHandled)).toBe(false)
    expect(await getText(page)).toBe('**굵게**')

    await run(page, 'new')
    await editor.click()
    const session = await page.context().newCDPSession(page)
    await session.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 })
    await clickViewMenu(app, '원문 보기 켜기/끄기')
    await session.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
    await session.send('Input.insertText', { text: '한' })
    await session.send('Input.insertText', { text: '글' })
    await page.keyboard.type(' **굵게**')
    expect(await getText(page)).toBe('한글 **굵게**')
    await expect(page.locator('#toggle-source')).toHaveClass(/active/)
    await expect(page.locator('.md-strong')).toHaveCount(0)
    await session.detach()
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('한글 조합 중 원문 보기를 켜고 바로 다른 탭에 갔다 와도 처음 탭이 원문 보기로 보인다', async () => {
  const { app, page, errors } = await launch()
  try {
    await setText(page, '# 첫째\n\n')
    await run(page, 'new')
    await setText(page, '# 둘째')
    await run(page, 'previousTab')
    // 실제 입력기는 탭을 옮긴 뒤에 조합이 끝나지만, 자동 테스트의 가짜 조합은 탭을 옮기면 끝을 알리지 못한다.
    // 그래서 "조합 중"을 직접 켜고 꺼서, 미뤄 둔 적용이 둘째 탭을 보고 있을 때 실행되게 한다.
    await page.evaluate(() => {
      const md = (window as any).__md
      ;(window as any).__composing = true
      Object.defineProperty(md.view, 'composing', { configurable: true, get: () => (window as any).__composing })
      void md.run('toggleSourceMode')
      void md.run('nextTab')
    })
    await page.evaluate(() => ((window as any).__composing = false))
    await page.waitForTimeout(200)
    await expect(page.locator('.cm-line').nth(0)).toHaveText('# 둘째')
    await run(page, 'previousTab')
    await expect(page.locator('#toggle-source')).toHaveClass(/active/)
    await expect(page.locator('.cm-line').nth(0)).toHaveText('# 첫째')
    await expect(page.locator('.md-h1')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('문법 창을 빠르게 여러 번 열고 닫아도 창 폭이 원래대로 돌아온다', async () => {
  const { app, page, errors } = await launch()
  try {
    const before = await windowWidthOf(app)
    const editorBefore = await page.locator('#editor').evaluate((element) => element.clientWidth)
    // 앞의 창 폭 응답을 기다리지 않고 연달아 누른다.
    const toggle = (times: number) =>
      page.evaluate((count) => Promise.all(Array.from({ length: count }, () => (window as any).__md.run('toggleSyntaxPanel'))), times)
    await toggle(6)
    await expect(page.locator('#syntax-panel')).toBeHidden()
    await expect.poll(() => windowWidthOf(app)).toBe(before)
    await toggle(5)
    await expect(page.locator('#syntax-panel')).toBeVisible()
    await expect.poll(() => page.locator('#editor').evaluate((element) => element.clientWidth)).toBe(editorBefore)
    await toggle(7)
    await expect(page.locator('#syntax-panel')).toBeHidden()
    await expect.poll(() => windowWidthOf(app)).toBe(before)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('좁은 창에서는 문법 창을 열지 않고 열림 상태와 창 폭도 그대로 둔다', async () => {
  const { app, page, errors } = await launch()
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setBounds({ ...window.getBounds(), width: 600 })
    })
    await expect.poll(() => windowWidthOf(app)).toBe(600)
    await clickViewMenu(app, '문법 창 보기/숨기기')
    await page.waitForTimeout(300)
    await expect(page.locator('#syntax-panel')).toBeHidden()
    expect(await windowWidthOf(app)).toBe(600)
    expect(await page.evaluate(() => localStorage.getItem('syntax-panel-open'))).toBeNull()
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
