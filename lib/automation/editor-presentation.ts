/**
 * Display copy for the rule editor's publication check. The count comes from
 * editorProblems; this helper only formats it so the browser test can assert
 * the same sentence the editor renders.
 */
export function ruleValidationSummary(count: number): string {
  return `公開前に ${count} 件の入力が必要です`;
}
