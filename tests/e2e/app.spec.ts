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

/** 자동완성 목록이 막 뜬 직후(75ms 안)의 키는 CodeMirror가 무시하므로 잠깐 기다렸다 누른다. */
const pressInList = async (page: Page, key: string) => {
  await page.waitForTimeout(150)
  await page.keyboard.press(key)
}

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

test('수평선·목록·체크박스·인용·콜아웃 기호를 숨기고, 커서가 닿은 줄은 원문을 보여준다', async () => {
  const { app, page, errors } = await launch()
  try {
    const content = [
      '---', 'title: 문서', '---', '',
      '큰 제목', '===', '',
      '- 사과', '  - 배', '    - 감', '',
      '1. 첫째', '',
      '- [ ] 할 일', '- [x] 한 일', '',
      '***', '',
      '> 인용', '> > 안쪽', '',
      '> [!NOTE]', '> 참고', '',
      '> [!TIP] 내 제목', '> 도움말', '',
      '```', '- 코드', '> 코드', '```', '',
      '끝'
    ].join('\n')
    await setText(page, content)
    const moveCursor = (pos: number) => page.evaluate((anchor) => (window as any).__md.view.dispatch({ selection: { anchor } }), pos)
    const cursor = () => page.evaluate(() => (window as any).__md.view.state.selection.main.head as number)
    await moveCursor(content.length)
    const lines = page.locator('.cm-line')
    const hidden = [
      '---', 'title: 문서', '---', '',
      '큰 제목', '', '',
      '● 사과', '○ 배', '■ 감', '',
      '1. 첫째', '',
      '할 일', '한 일', '',
      '', '',
      '인용', '안쪽', '',
      'Note', '참고', '',
      '내 제목', '도움말', '',
      '```', '- 코드', '> 코드', '```', '',
      '끝'
    ]
    await expect(lines).toHaveText(hidden)
    await expect(page.locator('.cm-callout-title')).toHaveText(['Note', '내 제목'])
    const checkboxes = page.locator('.cm-checkbox input')
    await expect(checkboxes).toHaveCount(2)
    await expect(checkboxes.nth(0)).not.toBeChecked()
    await expect(checkboxes.nth(1)).toBeChecked()

    // 체크박스 모양을 클릭하면 문서의 [ ] 가 바뀌고, 커서는 그대로라 계속 체크박스로 보인다.
    await page.locator('.cm-checkbox').first().click()
    expect(await getText(page)).toContain('- [x] 할 일\n- [x] 한 일')
    expect(await cursor()).toBe(content.length)
    await expect(checkboxes.nth(0)).toBeChecked()
    await page.locator('.cm-checkbox').nth(1).click()
    expect(await getText(page)).toContain('- [x] 할 일\n- [ ] 한 일')
    await expect(checkboxes.nth(1)).not.toBeChecked()

    // 커서가 닿은 줄만 원문을 보여준다.
    await moveCursor(content.indexOf('배'))
    await expect(lines.nth(8)).toHaveText('- 배')
    await expect(lines.nth(7)).toHaveText('● 사과')
    await moveCursor(content.indexOf('[!NOTE]'))
    await expect(lines.nth(21)).toHaveText('> [!NOTE]')
    await expect(lines.nth(22)).toHaveText('참고')
    await moveCursor(content.indexOf('큰 제목'))
    await expect(lines.nth(5)).toHaveText('===')
    // 숨긴 수평선 줄을 클릭하면 원문 *** 이 보인다.
    await page.locator('.cm-hr').first().click({ position: { x: 20, y: 8 } })
    await expect(page.locator('.cm-hr').first()).toHaveText('***')

    // 인용 줄에서 한글을 조합해도 글자가 깨지지 않는다.
    await moveCursor(content.indexOf('> 참고') + '> 참고'.length)
    const session = await page.context().newCDPSession(page)
    await session.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 })
    await session.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
    await session.send('Input.insertText', { text: '한' })
    await session.send('Input.insertText', { text: '글' })
    await session.detach()
    expect(await getText(page)).toContain('> [!NOTE]\n> 참고한글\n')
    await moveCursor(0)
    await expect(lines.nth(22)).toHaveText('참고한글')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
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
  await pressInList(page, 'ArrowRight')
  await expect(list.first()).toHaveText('무제 (빈 다이어그램)')
  await pressInList(page, 'ArrowDown')
  await pressInList(page, 'Enter')
  expect(await getText(page)).toBe(
    '```mermaid\nflowchart TD\n    A[시작] --> B{조건}\n    B -->|예| C[처리]\n    B -->|아니오| D[종료]\n```'
  )
  await expect(page.locator('.cm-preview-mermaid[data-state="ok"] svg')).toBeVisible({ timeout: 10_000 })
  await app.close()
})

test('줄 맨 앞 | → 표 › 3×3, < → 접기 상자 (코드 블록 안·줄 중간에선 안 뜬다)', async () => {
  const { app, page, errors } = await launch()
  const list = page.locator('.cm-tooltip-autocomplete li')
  const selection = () =>
    page.evaluate(() => {
      const { view } = (window as any).__md
      const { from, to } = view.state.selection.main
      return { from, to, text: view.state.sliceDoc(from, to) as string }
    })
  const press = (key: string) => pressInList(page, key)
  await page.locator('.cm-content').click()

  // 표: → 로 들어가서 고른다.
  await page.keyboard.type('|')
  await expect(list).toHaveText(['표›'])
  await press('ArrowRight')
  await expect(list).toHaveText(['3×3'])
  await press('ArrowLeft')
  await expect(list).toHaveText(['표›'])
  await press('ArrowRight')
  await expect(list).toHaveText(['3×3'])
  await press('Enter')
  expect(await getText(page)).toBe('|  |  |  |\n|---|---|---|\n|  |  |  |\n|  |  |  |')
  expect(await selection()).toEqual({ from: 2, to: 2, text: '' })
  await page.keyboard.type('이름')
  expect((await getText(page)).split('\n')[0]).toBe('| 이름 |  |  |')
  await expect(page.locator('.cm-preview-table th').first()).toHaveText('이름')

  // 표: 들여쓰기 뒤에서 Enter(선택)로 들어간다.
  await setText(page, '')
  await page.keyboard.type('  |')
  await expect(list).toHaveText(['표›'])
  await press('Enter')
  await expect(list).toHaveText(['3×3'])
  await press('Enter')
  expect(await getText(page)).toBe('  |  |  |  |\n  |---|---|---|\n  |  |  |  |\n  |  |  |  |')

  // 접기 상자
  await setText(page, '')
  await page.keyboard.type('<')
  await expect(list).toHaveText(['접기 상자'])
  await press('Enter')
  expect(await getText(page)).toBe('<details>\n<summary>제목</summary>\n\n내용\n\n</details>')
  expect((await selection()).text).toBe('제목')

  // 목록이 떠 있을 때 한글을 조합해 쳐도 글자가 깨지지 않고 목록은 닫힌다.
  await setText(page, '')
  await page.keyboard.type('|')
  await expect(list).toHaveText(['표›'])
  const session = await page.context().newCDPSession(page)
  await session.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 })
  await session.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
  await session.send('Input.insertText', { text: '한' })
  await session.send('Input.insertText', { text: '글' })
  await session.detach()
  expect(await getText(page)).toBe('|한글')
  await expect(list).toHaveCount(0)

  // 줄 중간, 코드 블록 안에서는 뜨지 않는다.
  for (const [before, mark] of [['글 ', '|'], ['글 ', '<'], ['```js\n', '|'], ['```js\n', '<']]) {
    await setText(page, before)
    await page.evaluate((pos) => (window as any).__md.view.dispatch({ selection: { anchor: pos } }), before.length)
    await page.keyboard.type(mark)
    await page.waitForTimeout(300)
    await expect(list).toHaveCount(0)
  }

  // 바로 위 줄이 표면 표 행을 이어 쓰는 중이라 뜨지 않고, Enter는 줄바꿈이 된다.
  await setText(page, '| a | b |\n|---|---|\n')
  await page.evaluate(() => (window as any).__md.view.dispatch({ selection: { anchor: '| a | b |\n|---|---|\n'.length } }))
  await page.keyboard.type('|')
  await page.waitForTimeout(300)
  await expect(list).toHaveCount(0)
  await page.keyboard.press('Enter')
  expect(await getText(page)).toBe('| a | b |\n|---|---|\n|\n')
  // 빈 줄로 떨어진 표 아래에서는 새 표를 만들 수 있으니 뜬다.
  await setText(page, '| a | b |\n|---|---|\n\n')
  await page.evaluate(() => (window as any).__md.view.dispatch({ selection: { anchor: '| a | b |\n|---|---|\n\n'.length } }))
  await page.keyboard.type('|')
  await expect(list).toHaveText(['표›'])
  expect(errors).toEqual([])
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
  // 마지막에 친 글까지 그려진 미리보기 글을 그대로 받아 검사한다. (다시 읽으면 그리는 도중의 빈 글을 읽을 수 있다)
  let text = ''
  await expect.poll(async () => (text = await page.evaluate(() => (window as any).__md.pdfPreviewText() as string))).toContain('굵은 글자와 코드')
  expect(text).toContain('미리보기 제목')
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

/**
 * 문법 창을 열어 창을 넓혀도 화면 작업 영역(CI의 Windows 서버는 1024×768)을 넘지 않게 창과 문법 창을 줄인다.
 * 화면을 넘으면 메인이 창 폭을 작업 영역 폭으로 잘라서 편집 화면이 줄어든다. (앱은 정상)
 * 실제 작업 영역 폭과 창 테두리 폭을 재서, 본문 폭 + 테두리 + 문법 창 + 막대가 작업 영역 안에 들어가게 한다.
 * 예: 1024px, 테두리 16px이면 본문 폭은 1024 - 16 - 220 - 6 = 782px 이하.
 * 본문 폭이 좁은 창 기준(760px)을 넘어야 문법 창이 열리므로, 그만큼도 남지 않는 작은 화면이면 폭 유지 검사가 의미 없어 건너뛴다.
 */
async function fitSyntaxPanelInSmallScreen(app: ElectronApplication, page: Page): Promise<void> {
  const panelWidth = 220 // 앱이 허용하는 문법 창 최소 폭
  const dividerWidth = 6
  const minContentWidth = 761 // 760px 이하에선 문법 창이 열리지 않는다 (style.css·main.ts의 좁은 창 기준)
  const { workAreaWidth, frameWidth, contentWidth } = await app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const bounds = window.getBounds()
    const contentWidth = window.getContentSize()[0]
    return { workAreaWidth: screen.getDisplayMatching(bounds).workArea.width, frameWidth: bounds.width - contentWidth, contentWidth }
  })
  const maxContentWidth = workAreaWidth - frameWidth - panelWidth - dividerWidth
  test.skip(
    maxContentWidth < minContentWidth,
    `화면 작업 영역 ${workAreaWidth}px이 너무 좁아, 문법 창이 열리는 최소 본문 폭 ${minContentWidth}px + 창 테두리 ${frameWidth}px + 문법 창 ${panelWidth + dividerWidth}px을 담을 수 없다`
  )
  // 큰 화면에선 처음 폭 그대로, 작은 화면에선 문법 창을 열어도 들어가는 폭으로 줄인다.
  const targetWidth = Math.max(minContentWidth, Math.min(contentWidth, maxContentWidth))

  await page.evaluate((width) => localStorage.setItem('syntax-panel-width', String(width)), panelWidth)
  await page.reload()
  await page.locator('.cm-content').waitFor()
  await expect(page.locator('#syntax-panel')).toHaveCSS('width', `${panelWidth}px`)
  await app.evaluate(({ BrowserWindow }, width) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setContentSize(width, window.getContentSize()[1])
  }, targetWidth)
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(targetWidth)
}

test('왼쪽 위 < 버튼·메뉴로 문법 창을 열고 닫으며, 단축키는 메뉴와 같은 글자로 OS에 맞게 보인다', async () => {
  const { app, page, errors } = await launch()
  try {
    const isMac = await app.evaluate(() => process.platform === 'darwin')
    const menu = await menuAcceleratorsByLabel(app)
    expect(menu['문법 창 보기/숨기기']).toBe('CmdOrCtrl+Alt+L')
    expect(menu['원문 보기 켜기/끄기']).toBe('CmdOrCtrl+/')
    await fitSyntaxPanelInSmallScreen(app, page)

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
    let previewText = ''
    await expect.poll(async () => (previewText = await page.evaluate(() => (window as any).__md.pdfPreviewText() as string))).toContain('추가')
    expect(previewText).not.toContain('**')
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
    await fitSyntaxPanelInSmallScreen(app, page)
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

test('미리보기·문법 창 때문에 창이 화면을 꽉 채워도 닫으면 원래 폭으로 돌아오고, 사용자가 최대화한 창은 그대로 둔다', async () => {
  const { app, page, errors } = await launch()
  try {
    const isMac = await app.evaluate(() => process.platform === 'darwin')
    const windowState = () =>
      app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        return { bounds: window.getBounds(), maximized: window.isMaximized() }
      })
    // 작은 화면(CI의 1024px Mac)처럼: 창 높이는 작업 영역 높이, 미리보기·문법 창을 열면 작업 영역 폭을 넘는 폭.
    // macOS는 이 창이 넓어져 작업 영역을 꽉 채우면 사용자가 최대화하지 않았어도 isMaximized()가 true다.
    const { area, contentWidth } = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const area = screen.getDisplayMatching(window.getBounds()).workArea
      window.setBounds({ x: area.x, y: area.y, width: area.width - 150, height: area.height })
      return { area, contentWidth: window.getContentSize()[0] }
    })
    test.skip(contentWidth <= 760, `화면 작업 영역 ${area.width}px이 너무 좁아 문법 창이 열리는 창 폭을 만들 수 없다`)
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(contentWidth)
    const before = (await windowState()).bounds
    const filled = { ...before, x: area.x, width: area.width }

    const preview = page.locator('#toggle-preview')
    const syntax = page.locator('#toggle-syntax')
    const expectFilled = async () => {
      await expect.poll(async () => (await windowState()).bounds).toEqual(filled)
      if (isMac) expect((await windowState()).maximized).toBe(true)
    }
    const expectRestored = () => expect.poll(async () => (await windowState()).bounds).toEqual(before)

    // PDF 미리보기만
    await preview.click()
    await expect(preview).toHaveText('<')
    await expectFilled()
    await preview.click()
    await expect(preview).toHaveText('>')
    await expectRestored()

    // 문법 창만
    await syntax.click()
    await expect(syntax).toHaveText('>')
    await expectFilled()
    await syntax.click()
    await expect(syntax).toHaveText('<')
    await expectRestored()

    // 둘 다 열고, 연 순서대로 닫기 / 반대 순서로 닫기
    for (const order of [[preview, syntax], [syntax, preview]]) {
      await preview.click()
      await expect(preview).toHaveText('<')
      await syntax.click()
      await expect(syntax).toHaveText('>')
      await expectFilled()
      for (const button of order) await button.click()
      await expect(preview).toHaveText('>')
      await expect(syntax).toHaveText('<')
      await expectRestored()
    }

    // 앱이 넓혀 꽉 찬 크기를 기억한 채로 사용자가 창을 줄였다가 최대화하면, macOS에선 기억한 크기와 최대화한 크기가 같다.
    // 그래도 사용자가 최대화한 창이므로 패널을 닫아도 줄이지 않는다.
    await preview.click()
    await expect(preview).toHaveText('<')
    await expectFilled()
    await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), before)
    await expect.poll(async () => (await windowState()).bounds).toEqual(before)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
    await expect.poll(async () => (await windowState()).maximized).toBe(true)
    const maximized = (await windowState()).bounds
    if (isMac) expect(maximized).toEqual(filled)
    await preview.click()
    await expect(preview).toHaveText('>')
    await page.waitForTimeout(300)
    expect(await windowState()).toEqual({ bounds: maximized, maximized: true })

    // 사용자가 최대화한 창은 다시 열고 닫아도 크기를 건드리지 않는다.
    await preview.click()
    await expect(preview).toHaveText('<')
    await syntax.click()
    await expect(syntax).toHaveText('>')
    await page.waitForTimeout(300)
    expect(await windowState()).toEqual({ bounds: maximized, maximized: true })
    await syntax.click()
    await expect(syntax).toHaveText('<')
    await preview.click()
    await expect(preview).toHaveText('>')
    await page.waitForTimeout(300)
    expect(await windowState()).toEqual({ bounds: maximized, maximized: true })
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

test('```mermaid 를 한 글자씩 쳐도, 내용이 비었거나 안 닫혔으면 오류를 보여주지 않는다', async () => {
  const { app, page, errors } = await launch()
  await page.locator('#toggle-preview').click()
  await page.locator('.cm-content').click()
  await page.keyboard.type('```mermaid', { delay: 30 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1_000)
  await expect(page.locator('.cm-preview-error')).toHaveCount(0)
  // 지금 문서로 다 그린 미리보기인지 알 수 있게, 다 친 뒤 mermaid 블록 앞에 확인용 문장을 넣고 그 문장이 보일 때 읽은 글로 검사한다.
  await page.evaluate(() => (window as any).__md.view.dispatch({ changes: { from: 0, insert: '미리보기 확인용 문장\n\n' } }))
  let previewText = ''
  await expect.poll(async () => (previewText = await page.evaluate(() => (window as any).__md.pdfPreviewText() as string))).toContain('미리보기 확인용 문장')
  expect(previewText).not.toMatch(/error|오류/i)

  // 닫힌 빈 블록도 마찬가지
  await setText(page, '```mermaid\n\n```')
  await page.waitForTimeout(1_000)
  await expect(page.locator('.cm-preview-error')).toHaveCount(0)

  // 문서 중간에서 아직 닫지 않은 블록은 아래 본문이 코드로 잡혀도 오류를 보여주지 않는다.
  await setText(page, '앞 본문\n\n```mermaid\n아래 본문')
  await page.waitForTimeout(1_000)
  await expect(page.locator('.cm-preview-error')).toHaveCount(0)
  // '아래 본문'은 이 문서에만 있는 글이라 확인용 문장 역할을 한다.
  await expect.poll(async () => (previewText = await page.evaluate(() => (window as any).__md.pdfPreviewText() as string))).toContain('아래 본문')
  expect(previewText).not.toMatch(/error|오류/i)

  // 닫은 뒤 내용이 틀렸으면 지금처럼 오류를 보여준다.
  await setText(page, '앞 본문\n\n```mermaid\n아래 본문\n```')
  await expect(page.locator('.cm-preview-error')).toContainText('Mermaid 문법 오류')
  await setText(page, '```mermaid\nflowchart TD\n    A -->\n```')
  await expect(page.locator('.cm-preview-error')).toContainText('Mermaid 문법 오류')
  expect(errors).toEqual([])
  await app.close()
})
