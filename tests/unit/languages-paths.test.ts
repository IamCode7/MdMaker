import { describe, expect, test } from 'vitest'
import { frontMatterLength, stripFrontMatter } from '../../src/renderer/src/markdown/frontMatter'
import { languageSuggestions, typedLanguage } from '../../src/renderer/src/markdown/languages'
import { dirname, fileURL, resolveImage } from '../../src/renderer/src/markdown/paths'

describe('코드 블록 언어 목록', () => {
  test('``` 뒤에 입력한 글자만 찾는다', () => {
    expect(typedLanguage('```s', true)).toBe('s')
    expect(typedLanguage('~~~py', true)).toBe('py')
    expect(typedLanguage('```', true)).toBeNull()
    expect(typedLanguage('글 ```s', true)).toBeNull()
    expect(typedLanguage('    ```s', true)).toBeNull()
    expect(typedLanguage('```sw', false)).toBeNull()
  })
  test('앞글자로 고르고, 다 입력했으면 목록을 닫는다', () => {
    expect(languageSuggestions('s')).toEqual(['scala', 'scss', 'shell', 'sql', 'swift'])
    expect(languageSuggestions('SW')).toEqual(['swift'])
    expect(languageSuggestions('swift')).toEqual([])
  })
})

describe('이미지 경로 (Mac·Windows)', () => {
  test('웹 주소는 그대로', () => {
    expect(resolveImage('https://a.com/b.png', null)).toEqual({ url: 'https://a.com/b.png' })
  })
  test('상대 경로는 문서 폴더 기준', () => {
    expect(resolveImage('img/a.png', '/Users/me/Docs')).toEqual({ url: fileURL('/Users/me/Docs/img/a.png') })
    expect(resolveImage('./a.png', 'C:\\Users\\me')).toEqual({ url: fileURL('C:\\Users\\me\\a.png') })
  })
  test('절대 경로', () => {
    expect(resolveImage('/tmp/a.png', null)).toEqual({ url: fileURL('/tmp/a.png') })
    expect(resolveImage('C:\\pics\\a.png', null)).toEqual({ url: fileURL('C:\\pics\\a.png') })
  })
  test('저장 안 한 문서의 상대 경로는 이유를 알려준다', () => {
    expect(resolveImage('a.png', null)).toHaveProperty('error')
  })
  test('폴더 이름', () => {
    expect(dirname('/Users/me/a.md')).toBe('/Users/me')
    expect(dirname('C:\\Users\\me\\a.md')).toBe('C:\\Users\\me')
  })
})

describe('Front matter', () => {
  test('닫힌 경우만 문서 정보로 본다', () => {
    expect(frontMatterLength('---\ntitle: 테스트\n---\n# 제목')).toBe(18)
    expect(frontMatterLength('---\n\n본문')).toBeNull()
    expect(stripFrontMatter('---\na: 1\n---\n본문')).toBe('\n본문')
  })
})
