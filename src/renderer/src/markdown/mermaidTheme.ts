/** Mermaid 흑백 기본 디자인. 다크 모드에선 어두운 바탕에 밝은 선으로 뒤집는다.
 * 문서에서 `config: theme:`를 따로 쓰면 그 설정이 우선한다. */
export function mermaidConfig(dark: boolean): Record<string, unknown> {
  const ink = dark ? '#F2F2F2' : '#1D1D1F' // 글자·테두리·선
  const paper = dark ? '#1E1E1E' : '#FFFFFF' // 상자 바탕 (편집기 바탕색과 같게)
  const shade = dark ? '#2C2C2C' : '#F2F2F2' // 묶음·메모 바탕
  const grays = dark
    ? ['#5A5A5A', '#4A4A4A', '#3C3C3C', '#303030', '#262626', '#6E6E6E']
    : ['#D9D9D9', '#BFBFBF', '#A6A6A6', '#ECECEC', '#8C8C8C', '#F5F5F5']
  const font = '-apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif'

  const variables: Record<string, string> = {
    fontFamily: font,
    fontSize: '14px',
    background: paper,
    primaryColor: paper, primaryTextColor: ink, primaryBorderColor: ink,
    secondaryColor: shade, secondaryTextColor: ink, secondaryBorderColor: ink,
    tertiaryColor: paper, tertiaryTextColor: ink, tertiaryBorderColor: ink,
    lineColor: ink, textColor: ink, titleColor: ink,
    edgeLabelBackground: paper,
    clusterBkg: shade, clusterBorder: ink,
    rowOdd: paper, rowEven: shade,
    attributeBackgroundColorOdd: paper, attributeBackgroundColorEven: shade,
    noteBkgColor: shade, noteTextColor: ink, noteBorderColor: ink,
    actorBkg: paper, actorBorder: ink, actorTextColor: ink, actorLineColor: ink,
    signalColor: ink, signalTextColor: ink, labelBoxBkgColor: paper, labelBoxBorderColor: ink,
    labelTextColor: ink, loopTextColor: ink, activationBkgColor: shade, activationBorderColor: ink,
    taskBkgColor: grays[0], taskBorderColor: ink, taskTextColor: ink, taskTextDarkColor: ink,
    taskTextOutsideColor: ink, activeTaskBkgColor: shade, activeTaskBorderColor: ink,
    doneTaskBkgColor: grays[2], doneTaskBorderColor: ink, critBkgColor: grays[4], critBorderColor: ink,
    sectionBkgColor: shade, altSectionBkgColor: paper, sectionBkgColor2: shade,
    gridColor: grays[1], todayLineColor: ink,
    pieStrokeColor: ink, pieOuterStrokeColor: ink, pieTitleTextColor: ink,
    pieSectionTextColor: ink, pieLegendTextColor: ink
  }
  grays.forEach((gray, index) => (variables[`pie${index + 1}`] = gray))
  for (let index = 0; index < 12; index++) {
    variables[`cScale${index}`] = grays[index % grays.length]
    variables[`cScaleLabel${index}`] = ink
  }

  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: font,
    themeVariables: variables,
    // 상자 그림자를 없앤다 (다크 모드에서 하얗게 번져 보인다)
    themeCSS: '* { filter: none !important; }'
  }
}
