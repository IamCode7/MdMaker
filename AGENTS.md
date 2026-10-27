# MdMaker 작업 규칙

쓰는 그대로 PDF가 보이는 마크다운 편집기. Electron + TypeScript + CodeMirror 6.

## 구조

- `src/main/` — Electron 메인 프로세스 (창, 메뉴, 파일 열기·저장, PDF 내보내기)
- `src/preload/` — 메인과 화면 사이 API
- `src/renderer/src/editor/` — 편집 화면. 문법 꾸미기·그림 미리보기는 `livePreview.ts`, 색칠은 `highlight.ts`
- `src/renderer/src/markdown/` — 마크다운 → HTML 변환과 편집 도우미
- `src/renderer/src/preview.ts` — 오른쪽 A4 PDF 미리보기
- `tests/unit/` — Vitest 단위 테스트, `tests/e2e/` — Playwright 앱 테스트

## 명령

```bash
npm run typecheck   # 타입 검사
npm test            # 단위 테스트
npm run e2e         # 앱을 띄워서 하는 테스트
npm run dev         # 개발 모드로 실행
```

## 규칙

- 주석과 테스트 이름은 한국어로, 주변 코드 스타일(`// MARK: -` 구역 나누기 등)에 맞춘다.
- 부탁받은 부분만 고친다. 관계없는 코드는 정리하거나 바꾸지 않는다.
- 끝나면 `npm run typecheck`와 `npm test`를 통과시킨다.
- 편집 화면을 바꿀 땐 한글 입력(조합 중)이 깨지지 않는지 신경 쓴다.
- 패키지를 설치하거나 지우지 않는다. (`package.json`, `package-lock.json`을 바꾸지 않는다)
- git add / commit / push / merge는 하지 않는다. 코드만 고치고, git은 사용자가 직접 한다.
