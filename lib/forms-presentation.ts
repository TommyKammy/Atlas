export function formStatusLabel(published: boolean): "公開中" | "下書き" {
  return published ? "公開中" : "下書き";
}

export function formCardMeta(fieldCount: number, responseCount: number): string {
  return `${fieldCount} 項目 ・ 回答 ${responseCount} 件`;
}
