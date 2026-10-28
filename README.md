<div align="center">

# ![MdMaker 아이콘](docs/icon48.png) MdMaker

쓰는 그대로 PDF가 보이는 마크다운 편집기

[![release](https://img.shields.io/badge/Release-v2.0.1-blue?style=flat&logo=github&labelColor=1f2937)](https://github.com/IamCode7/MdMaker/releases/tag/v2.0.1)![platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey?style=flat&labelColor=1f2937)![license](https://img.shields.io/badge/Licenses-MPL%202.0-orange?style=flat&labelColor=1f2937)

</div>

## 주요 기능

| 기능               | 설명                                                         |
| ------------------ | ------------------------------------------------------------ |
| ✏️ 실시간 꾸미기    | `**굵게**`, `# 제목`을 입력하는 즉시 굵게·큰 글씨로 표시     |
| 👀 PDF 미리보기     | 오른쪽에 PDF와 똑같은 A4 화면을 띄우고 입력하는 대로 바로 반영 |
| 📄 PDF 내보내기     | 쪽 나눔까지 미리보기와 같은 PDF로 저장                       |
| 🧩 Mermaid 다이어그램 | 순서도·순서 다이어그램·원 그래프 등을 코드 아래에 바로 그림  |
| 🎨 코드 색칠        | ```` ``` ```` 뒤 언어 이름에 맞춰 예약어·문자열·주석을 색칠  |
| 🗂️ 언어 목록        | ```` ``` ```` 뒤에 글자를 입력하면 언어 목록이 뜸, mermaid는 다이어그램 종류까지 |
| 📊 표·이미지        | 표와 이미지를 원문 아래에 실제 모양으로 표시                 |
| 📌 콜아웃·각주      | `> [!NOTE]` 같은 GitHub 콜아웃과 `[^1]` 각주 지원            |
| ☑️ 체크박스         | `- [ ]` 를 클릭해서 체크                                     |
| 🔗 링크 열기        | 링크를 ⌘(Windows는 Ctrl) + 클릭해서 브라우저로 열기          |
| 🗃️ 탭              | 여러 문서를 한 창에서 탭으로 열기                            |
| 🌙 다크 모드        | 시스템 설정에 맞춰 편집 화면과 다이어그램이 함께 바뀜        |

> [!TIP]
> 편집 화면 오른쪽 위의 `>` 버튼(⌥⌘P)을 누르면 PDF 미리보기가 열린다. 열려 있을 땐 `<`로 닫는다.



## 설치

[Releases](https://github.com/IamCode7/MdMaker/releases/latest)에서 받는다. 설치 없이 파일 하나로 실행된다.

| OS                         | 파일                         | 실행                                   |
| -------------------------- | ---------------------------- | -------------------------------------- |
| Windows                    | `MdMaker-v2.0.1-windows.exe` | 더블클릭                               |
| macOS (Apple Silicon)      | `MdMaker-v2.0.1-mac.zip`     | 압축을 풀고 `MdMaker.app`을 더블클릭   |

> [!NOTE]
> 서명하지 않은 앱이라 처음 실행할 때 경고가 뜬다.
> - Windows: **Windows의 PC 보호** 창에서 **추가 정보 → 실행**
> - macOS: 앱을 오른쪽 클릭 → **열기**



## 단축키

| 기능                 | macOS | Windows      |
| -------------------- | ----- | ------------ |
| 굵게 / 기울임        | ⌘B / ⌘I | Ctrl+B / Ctrl+I |
| 취소선 / 코드        | ⇧⌘X / ⇧⌘C | Ctrl+Shift+X / Ctrl+Shift+C |
| 링크                 | ⌘K    | Ctrl+K       |
| 저장 / 다른 이름으로 저장 | ⌘S / ⇧⌘S | Ctrl+S / Ctrl+Shift+S |
| PDF 미리보기 열기·닫기 | ⌥⌘P   | Ctrl+Alt+P   |
| PDF로 내보내기       | ⌥⌘E   | Ctrl+Alt+E   |
| 새 탭 / 탭 닫기      | ⌘N / ⌘W | Ctrl+N / Ctrl+W |



## 직접 빌드

[Node.js](https://nodejs.org) 24 이상이 필요하다.

```bash
npm ci
npm run dev        # 개발 모드로 실행
npm test           # 단위 테스트
npm run e2e        # 앱을 띄워서 하는 테스트
npm run dist:mac   # macOS 실행 파일 (dist/)
npm run dist:win   # Windows 실행 파일 (dist/)
```



## 기술 스택

- Electron + TypeScript (Vite로 빌드)
- 편집기: CodeMirror 6
- 마크다운 변환: markdown-it
- 다이어그램: Mermaid / 코드 색칠: highlight.js
- 테스트: Vitest, Playwright



## 라이선스

[MPL-2.0](LICENSE)

함께 들어 있는 오픈소스 라이브러리의 라이선스는 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)에 있다.
