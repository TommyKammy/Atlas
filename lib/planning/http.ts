import type { NextRequest } from "next/server";
import { getWorkspace } from "../data";
import { badRequest, notFound } from "../api/errors";
import { isObject } from "./validation";

export function parsePortfolioId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw notFound("ポートフォリオが見つかりません");
  return id;
}

export async function requireWorkspaceId(): Promise<number> {
  const workspace = await getWorkspace();
  if (!workspace) throw notFound("ワークスペースが見つかりません");
  return workspace.id;
}

export async function readObjectBody(req: NextRequest): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  if (!isObject(body)) throw badRequest("リクエストの内容が正しくありません");
  return body;
}
