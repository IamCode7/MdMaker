// 앱에 함께 묶여 배포되는 라이브러리들의 라이선스 문구를 THIRD_PARTY_NOTICES.txt로 모은다.
// (npm run notices — 실행 파일을 만들 때 자동으로 실행된다)
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.join(__dirname, '..')
/** 화면 코드에 직접 들어가는 라이브러리. 이들의 하위 의존성까지 따라간다. */
const BUNDLED = [
  '@codemirror/autocomplete', '@codemirror/commands', '@codemirror/lang-markdown', '@codemirror/language',
  '@codemirror/language-data', '@codemirror/search', '@codemirror/state', '@codemirror/view',
  '@lezer/common', '@lezer/highlight', '@lezer/markdown',
  'markdown-it', 'markdown-it-footnote', 'highlight.js', 'mermaid'
]

const packages = new Map()

function findPackageDir(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    if (path.dirname(dir) === dir) return null
  }
}

function visit(name, fromDir) {
  const dir = findPackageDir(name, fromDir)
  if (!dir) return
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const key = `${pkg.name}@${pkg.version}`
  if (packages.has(key)) return
  const licenseFile = fs.readdirSync(dir).find((file) => /^(licen[cs]e|copying)(\.|$)/i.test(file))
  packages.set(key, {
    license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'SEE LICENSE FILE',
    text: licenseFile ? fs.readFileSync(path.join(dir, licenseFile), 'utf8').trim() : ''
  })
  for (const dependency of Object.keys(pkg.dependencies ?? {})) visit(dependency, dir)
}

BUNDLED.forEach((name) => visit(name, projectRoot))

const sections = [...packages]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, { license, text }]) => `${'='.repeat(78)}\n${key} (${license})\n${'='.repeat(78)}\n${text || `License: ${license}`}\n`)

const header = `MdMaker에 함께 들어 있는 오픈소스 소프트웨어
Third-party software included in MdMaker

MdMaker 자체는 Mozilla Public License 2.0(LICENSE 파일)을 따릅니다.
아래 라이브러리는 각자의 라이선스를 따릅니다. (${packages.size}개)
Electron과 Chromium의 라이선스는 앱 안의 LICENSE.electron.txt, LICENSES.chromium.html에 있습니다.

`
fs.writeFileSync(path.join(projectRoot, 'THIRD_PARTY_NOTICES.txt'), header + sections.join('\n'))
console.log(`THIRD_PARTY_NOTICES.txt: ${packages.size}개 라이브러리`)
