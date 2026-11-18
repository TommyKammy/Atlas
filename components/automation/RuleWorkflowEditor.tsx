"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import type { RuleDescriptors } from "@/lib/automation/descriptors";
import type { RuleEditorDraftData } from "@/lib/automation/editor-drafts";
import { ruleEditorDraft, toggleRuleBranches } from "@/lib/automation/editor-draft";
import { canonicalEditorDocument, editorHistory, editorPayload, editorProblems, editorSignature, rebaseEditorCredentials, withEditorKeys, type RuleEditorDocument, type RuleEditorProblem, type RuleEditorSelection } from "@/lib/automation/editor-model";
import { hasTaskSubject } from "@/lib/automation/task-target";
import type { ProjectRule, RuleAction, RuleDefinition } from "@/lib/automation/types";
import { confirmAction, toast } from "@/lib/ui-feedback";
import Dialog from "../ui/Dialog";
import RuleWorkflowCanvas from "./RuleWorkflowCanvas";
import RuleStepInspector from "./RuleStepInspector";
import RulePreviewDialog from "./RulePreviewDialog";
import RuleExecutionHistory from "./RuleExecutionHistory";

const inputClass = "h-9 w-full rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]";
const buttonClass = "inline-flex h-8 items-center justify-center rounded-md border border-neutral-200 bg-surface px-3 text-[12px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-40";
type Suggestion = { name: string; description: string; definition: RuleDefinition };

export default function RuleWorkflowEditor({ project, descriptors, initialRule, initialDraft, canEdit }: {
  project: { id: number; name: string }; descriptors: RuleDescriptors; initialRule: ProjectRule | null;
  initialDraft: RuleEditorDraftData | null; canEdit: boolean;
}) {
  const router = useRouter();
  const initialDocument = useMemo<RuleEditorDocument>(() => { let key = 0; return withEditorKeys({
    ...ruleEditorDraft(initialDraft ?? initialRule ?? { name: "", description: "", definition: {
      version: 1, triggers: [{ event: "task.created" }], actions: [],
    } }), enabled: initialDraft?.enabled ?? initialRule?.enabled ?? true,
  }, () => `initial-${key++}`); }, [initialDraft, initialRule]);
  const [history, dispatch] = useReducer(editorHistory, { past: [], present: initialDocument, future: [] });
  const document = history.present;
  const signature = editorSignature(document);
  const [savedSignature, setSavedSignature] = useState(initialDraft || initialRule ? signature : "");
  const savedSignatureRef = useRef(savedSignature);
  const draftRef = useRef<RuleEditorDraftData | null>(initialDraft);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveGeneration = useRef(0);
  const hasConflict = useRef(false);
  const canonicalResponse = useRef<{ sent: RuleEditorDocument; saved: RuleEditorDraftData } | null>(null);
  const mounted = useRef(true);
  const [draftData, setDraftData] = useState(initialDraft);
  const [ruleId, setRuleId] = useState(initialDraft?.rule_id ?? initialRule?.id ?? null);
  const [selected, setSelected] = useState<RuleEditorSelection | null>({ kind: "trigger", index: 0 });
  const [focusCondition, setFocusCondition] = useState<{ index: number; request: number } | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"editor" | "history" | "settings">("editor");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<"draft_conflict" | "rule_conflict" | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [reloading, setReloading] = useState(false);
  const editingBusy = publishing || reloading;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [palette, setPalette] = useState<{ branch?: number } | null>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const aiRequest = useRef<AbortController | null>(null);
  const apiBase = `/api/projects/${project.id}/rules`;
  const changed = signature !== savedSignature;
  const problems = editorProblems(document, descriptors);
  const published = draftData ? !draftData.has_unpublished_changes && !changed : Boolean(initialRule) && !changed;
  const leaveState = useRef({ document, canEdit, conflict, changed });
  useEffect(() => { leaveState.current = { document, canEdit, conflict, changed }; }, [document, canEdit, conflict, changed]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; aiRequest.current?.abort(); };
  }, []);

  const persist = useCallback((next: RuleEditorDocument): Promise<RuleEditorDraftData> => {
    const generation = saveGeneration.current;
    const operation = queueRef.current.then(async () => {
      if (generation !== saveGeneration.current || hasConflict.current) throw new Error("以前の保存操作を中止しました");
      const outgoing = canonicalResponse.current ? rebaseEditorCredentials(next, canonicalResponse.current.sent, canonicalResponse.current.saved) : next;
      const payload = editorPayload(outgoing);
      const nextSignature = editorSignature(outgoing);
      if (draftRef.current && savedSignatureRef.current === nextSignature) return draftRef.current;
      if (mounted.current) { setSaveState("saving"); setError(""); }
      try {
        let current = draftRef.current;
        if (!current) {
          const created = await api<{ draft: RuleEditorDraftData }>(`${apiBase}/drafts`, "POST", {
            ...(initialRule ? { rule_id: initialRule.id } : {}),
          });
          current = created.draft;
          draftRef.current = current;
        }
        const saved = await api<{ draft: RuleEditorDraftData }>(`${apiBase}/drafts/${current.id}`, "PUT", {
          ...payload, expected_revision: current.revision,
        });
        draftRef.current = saved.draft;
        const canonical = canonicalEditorDocument(outgoing, saved.draft);
        const savedValue = editorSignature(canonical);
        if (generation !== saveGeneration.current) return saved.draft;
        canonicalResponse.current = { sent: outgoing, saved: saved.draft };
        savedSignatureRef.current = savedValue;
        if (mounted.current) {
          setDraftData(saved.draft);
          setSavedSignature(savedValue);
          dispatch({ type: "rebase", sent: outgoing, saved: saved.draft });
          setSaveState("saved");
          if (!initialRule && !saved.draft.rule_id) {
            window.history.replaceState(null, "", `/projects/${project.id}/rules/new?draft=${encodeURIComponent(saved.draft.id)}`);
          }
        }
        return saved.draft;
      } catch (caught) {
        if (mounted.current && generation === saveGeneration.current) {
          setSaveState("error");
          setError(caught instanceof Error ? caught.message : "下書きを保存できませんでした");
          if (caught instanceof ApiError && caught.status === 409) { hasConflict.current = true; saveGeneration.current += 1; setConflict("draft_conflict"); }
        }
        throw caught;
      }
    });
    queueRef.current = operation.catch(() => undefined);
    return operation;
  }, [apiBase, initialRule, project.id]);

  useEffect(() => () => {
    const latest = leaveState.current;
    // SPA back/forward keeps JS alive: flush the latest unsaved edit on unmount.
    if (latest.canEdit && latest.changed && !latest.conflict) void persist(latest.document).catch(() => undefined);
  }, [persist]);

  useEffect(() => {
    let navigating = false;
    const navigate = (event: MouseEvent) => {
      if (!canEdit || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      if (editingBusy) { event.preventDefault(); event.stopPropagation(); return; }
      if (!changed && saveState !== "saving") return;
      event.preventDefault(); event.stopPropagation();
      if (navigating) return;
      navigating = true;
      void (async () => {
        try { await persist(document); }
        catch { if (!(await confirmAction("下書きを保存できませんでした。未保存の内容を破棄して移動しますか？"))) { navigating = false; return; } }
        router.push(`${url.pathname}${url.search}${url.hash}`);
      })();
    };
    window.addEventListener("click", navigate, true);
    return () => window.removeEventListener("click", navigate, true);
  }, [canEdit, changed, saveState, persist, document, router, editingBusy]);

  useEffect(() => {
    if (!canEdit || !changed || conflict || editingBusy) return;
    const timer = setTimeout(() => void persist(document).catch(() => undefined), 1200);
    return () => clearTimeout(timer);
  }, [canEdit, changed, conflict, document, persist, editingBusy]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!changed && saveState !== "saving") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [changed, saveState]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (editingBusy) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "s" && canEdit && !conflict) {
        event.preventDefault();
        void persist(document).catch(() => undefined);
      }
      if (event.key.toLowerCase() !== "z" || !canEdit) return;
      if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [canEdit, conflict, document, persist, editingBusy]);

  const change = (next: RuleEditorDocument) => { if (canEdit && !editingBusy) dispatch({ type: "change", document: withEditorKeys(next) }); };
  const addTrigger = () => {
    if (document.triggers.length >= descriptors.limits.triggersPerRule) return;
    change({ ...document, triggers: [...document.triggers, { event: "task.created" }] });
    setSelected({ kind: "trigger", index: document.triggers.length });
  };
  const addAction = (branch?: number) => { setPaletteQuery(""); setPalette(branch === undefined ? {} : { branch }); };
  const chooseAction = (capability: string) => {
    if (!palette) return;
    const action: RuleAction = { capability, params: {} };
    const descriptor = descriptors.actions.find((entry) => entry.id === capability);
    for (const param of descriptor?.params ?? []) {
      if (param.type === "select" && param.options?.length) action.params[param.name] = param.options[0].value;
    }
    if (palette.branch === undefined) {
      change({ ...document, actions: [...document.actions, action] });
      setSelected({ kind: "action", index: document.actions.length });
    } else {
      const index = document.branches[palette.branch].actions.length;
      change({ ...document, branches: document.branches.map((branch, i) => i === palette.branch ? { ...branch, actions: [...branch.actions, action] } : branch) });
      setSelected({ kind: "action", index, branch: palette.branch });
    }
    setPalette(null);
  };
  const addBranch = () => {
    change({ ...document, useBranches: true, branches: [...document.branches, { name: `パス${document.branches.length + 1}`, conditions: [], actions: [] }] });
    setSelected({ kind: "branch", index: document.branches.length });
  };
  const selectProblem = (problem: RuleEditorProblem) => {
    setTab("editor");
    if (problem.selection) setSelected(problem.selection);
    else nameInput.current?.focus();
    setFocusCondition((previous) => problem.conditionIndex === undefined ? null : { index: problem.conditionIndex, request: (previous?.request ?? 0) + 1 });
  };
  const publish = async () => {
    if (!canEdit || publishing || conflict) return;
    if (problems.length) { selectProblem(problems[0]); return; }
    setPublishing(true);
    setError("");
    try {
      const saved = await persist(document);
      const result = await api<{ draft: RuleEditorDraftData; rule_id: number }>(`${apiBase}/drafts/${saved.id}/publish`, "POST", { expected_revision: saved.revision });
      if (!mounted.current) return;
      draftRef.current = result.draft;
      setDraftData(result.draft);
      setRuleId(result.rule_id);
      const canonical = canonicalEditorDocument(document, result.draft);
      canonicalResponse.current = { sent: document, saved: result.draft };
      leaveState.current = { document: canonical, canEdit, conflict: null, changed: false };
      const savedValue = editorSignature(canonical);
      savedSignatureRef.current = savedValue;
      setSavedSignature(savedValue);
      dispatch({ type: "reset", document: canonical });
      toast(document.enabled ? "ルールを公開しました" : "ルールを停止状態で公開しました");
      router.replace(`/projects/${project.id}/rules/${result.rule_id}`);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : "公開できませんでした");
      if (caught instanceof ApiError && caught.status === 409) {
        hasConflict.current = true; saveGeneration.current += 1;
        const code = caught.body && typeof caught.body === "object" && "code" in caught.body ? caught.body.code : undefined;
        setConflict(code === "rule_conflict" ? "rule_conflict" : "draft_conflict");
      }
    } finally {
      if (mounted.current) setPublishing(false);
    }
  };
  const reloadDraft = async () => {
    if (!draftRef.current || !(await confirmAction("編集中の内容を破棄して、最新の状態を読み込みますか？"))) return;
    saveGeneration.current += 1;
    setReloading(true);
    try {
      await queueRef.current;
      const current = draftRef.current!;
      let next: RuleEditorDraftData;
      if (conflict === "rule_conflict") {
        await api(`${apiBase}/drafts/${current.id}`, "DELETE", { expected_revision: current.revision });
        next = (await api<{ draft: RuleEditorDraftData }>(`${apiBase}/drafts`, "POST", { rule_id: ruleId })).draft;
      } else {
        next = (await api<{ draft: RuleEditorDraftData }>(`${apiBase}/drafts/${current.id}`)).draft;
      }
      const nextDocument = withEditorKeys({ ...ruleEditorDraft(next), enabled: next.enabled });
      const nextSignature = editorSignature(nextDocument);
      draftRef.current = next;
      canonicalResponse.current = null;
      setDraftData(next);
      savedSignatureRef.current = nextSignature;
      setSavedSignature(nextSignature);
      dispatch({ type: "reset", document: nextDocument });
      hasConflict.current = false;
      setConflict(null); setError(""); setSaveState("saved"); setSelected(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "読み込みに失敗しました"); }
    finally { setReloading(false); }
  };
  const discardDraft = async () => {
    if (editingBusy || !(await confirmAction("下書きを破棄しますか？公開済みのルールは変更されません。"))) return;
    saveGeneration.current += 1;
    setReloading(true);
    try {
      await queueRef.current;
      const current = draftRef.current;
      if (current) await api(`${apiBase}/drafts/${current.id}`, "DELETE", { expected_revision: current.revision });
      hasConflict.current = true;
      leaveState.current = { document, canEdit: false, conflict: null, changed: false };
      router.push(`/projects/${project.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "下書きを破棄できませんでした");
      if (caught instanceof ApiError && caught.status === 409) { hasConflict.current = true; setConflict("draft_conflict"); }
      setReloading(false);
    }
  };
  const suggest = async () => {
    if (aiBusy || !aiPrompt.trim()) return;
    aiRequest.current?.abort();
    const controller = new AbortController();
    aiRequest.current = controller;
    setAiBusy(true); setError(""); setSuggestion(null);
    try {
      const result = await api<Suggestion>(`${apiBase}/ai-suggest`, { method: "POST", body: { prompt: aiPrompt }, signal: controller.signal });
      if (!controller.signal.aborted) setSuggestion(result);
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "提案を取得できませんでした"); }
    finally { if (!controller.signal.aborted) setAiBusy(false); }
  };
  const applyTemplate = (kind: "complete" | "status") => {
    const status = descriptors.actions.find((entry) => entry.id === "task.set_status")?.params.find((param) => param.name === "status")?.options?.[0]?.value ?? "進行中";
    change({ ...ruleEditorDraft({ name: kind === "complete" ? "完了時にコメントする" : "新規タスクのStatusを設定", description: "", definition: {
      version: 1, triggers: [{ event: kind === "complete" ? "task.completed" : "task.created" }],
      actions: [kind === "complete" ? { capability: "task.add_comment", params: { body: "完了しました: {{task.name}}" } }
        : { capability: "task.set_status", params: { status } }],
    } }), enabled: document.enabled });
    setSelected({ kind: "action", index: 0 }); setTemplatesOpen(false);
  };

  return <div className="flex h-full min-h-[560px] flex-col overflow-hidden bg-surface" data-rule-workflow-editor>
    <header className="shrink-0 border-b border-neutral-200 bg-surface px-5 pt-4 sm:px-6">
      <div className="mb-3 text-[12px] text-muted"><Link href={`/projects/${project.id}`} className="hover:text-neutral-800">{project.name}</Link><span className="px-2">/</span>ルール</div>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/projects/${project.id}`} aria-label="プロジェクトに戻る" className="text-xl text-muted" onClick={async (event) => {
          if (!changed && saveState !== "saving") return;
          event.preventDefault();
          if (await confirmAction("未保存の変更があります。このページを離れますか？")) router.push(`/projects/${project.id}`);
        }}>←</Link>
        <label className="min-w-[180px] flex-1"><span className="sr-only">ルール名</span><input ref={nameInput} aria-label="ルール名" value={document.name} placeholder="ルール名を入力" maxLength={120} readOnly={!canEdit || editingBusy}
          onChange={(event) => change({ ...document, name: event.target.value })} className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-[18px] font-semibold outline-none hover:border-neutral-200 focus:border-[#2c60b8]" /></label>
        <span className={`rounded px-2 py-1 text-[11px] ${published ? "bg-success-soft text-green-800" : "bg-surface-muted text-secondary"}`}>{published ? document.enabled ? "公開済み" : "停止中" : "下書き"}</span>
        <span role="status" aria-live="polite" className="text-[11px] text-muted" data-rule-save-status>{saveState === "saving" ? "保存中…" : saveState === "error" ? "保存できませんでした" : changed ? "未保存の変更" : "✓ 保存済み"}</span>
        {canEdit && <div className="flex items-center gap-2">
          <button type="button" className={buttonClass} disabled={Boolean(conflict) || editingBusy} onClick={() => void persist(document).catch(() => undefined)}>下書きを保存</button>
          <button type="button" className={buttonClass} onClick={() => setPreviewOpen(true)}>▷ テスト</button>
          <button type="button" onClick={() => void publish()} disabled={editingBusy || Boolean(conflict) || problems.length > 0} aria-describedby={problems.length ? "rule-validation-heading" : undefined} className="h-8 rounded-md bg-accent px-4 text-[12px] font-medium text-white hover:bg-[#24529c] disabled:opacity-40">{publishing ? "公開中…" : "公開する"}</button>
        </div>}
      </div>
      <nav aria-label="ルールエディター" className="mt-3 flex flex-wrap gap-5 text-[12px]">
        {([['editor', 'エディター'], ['history', '実行履歴'], ['settings', '設定']] as const).map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}
          className={`border-b-2 px-1 py-3 ${tab === id ? "border-accent font-semibold text-accent-text" : "border-transparent text-secondary"}`}>{label}</button>)}
        {canEdit && <div className="ml-auto flex items-center gap-2 pb-2">
          <button type="button" className={buttonClass} disabled={editingBusy} onClick={() => setTemplatesOpen(true)}>テンプレート</button>
          <button type="button" className={buttonClass} disabled={editingBusy} onClick={() => setAiOpen(true)}>AIアシスト</button>
        </div>}
      </nav>
    </header>
    {!canEdit && <p className="border-b border-neutral-200 bg-surface-subtle px-6 py-3 text-[12px] text-secondary">閲覧モードです。ルールの編集・公開は所有者が行えます。</p>}
    {canEdit && problems.length > 0 && <section data-rule-validation-summary aria-labelledby="rule-validation-heading" className="max-h-44 shrink-0 overflow-y-auto border-b border-amber-200 bg-warning-soft px-6 py-3 text-[12px] text-amber-950">
      <h2 id="rule-validation-heading" className="font-semibold">公開前に入力を確認してください</h2>
      <p className="mt-1 leading-5">未入力の内容は下書きに保存できます。次の項目を修正すると公開できます。</p>
      <ul className="mt-2 space-y-1">{problems.map((problem, index) => <li key={index}><button type="button" onClick={() => selectProblem(problem)} className="text-left leading-5 underline decoration-amber-700/50 underline-offset-2 hover:decoration-amber-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2c60b8]">{problem.label}</button></li>)}</ul>
    </section>}
    {(error || conflict) && <div role="alert" className="shrink-0 border-b border-rose-200 bg-rose-50 px-6 py-3 text-[12px] text-rose-700">
      <p>{error}</p>{conflict && <div className="mt-2 flex flex-wrap items-center gap-3"><span>編集中の内容は保持しています。</span><button type="button" className={buttonClass} onClick={() => void reloadDraft()}>{conflict === "rule_conflict" ? "公開版から読み直す（編集内容を破棄）" : "最新の下書きを読み込む（編集内容を破棄）"}</button></div>}
    </div>}
    {tab === "editor" && <div className="relative flex min-h-0 flex-1">
      <RuleWorkflowCanvas document={document} descriptors={descriptors} selected={selected} readOnly={!canEdit || editingBusy}
        onSelect={setSelected} onAddTrigger={addTrigger} onAddAction={addAction} onAddBranch={addBranch}
        onToggleBranches={() => { change({ ...toggleRuleBranches(document, { capability: "task.complete", params: {} }), enabled: document.enabled }); setSelected({ kind: "conditions" }); }}
        canUndo={history.past.length > 0} canRedo={history.future.length > 0} onUndo={() => dispatch({ type: "undo" })} onRedo={() => dispatch({ type: "redo" })} />
      {selected && <RuleStepInspector projectId={project.id} document={document} descriptors={descriptors} selected={selected} readOnly={!canEdit || editingBusy}
        onChange={change} onSelect={setSelected} onClose={() => setSelected(null)} onAddAction={addAction} focusCondition={focusCondition} />}
    </div>}
    {tab === "history" && <RuleExecutionHistory projectId={project.id} ruleId={ruleId} descriptors={descriptors} />}
    {tab === "settings" && <div className="min-h-0 flex-1 overflow-auto p-6"><fieldset disabled={!canEdit || editingBusy} className="max-w-xl space-y-5">
      <h2 className="text-[16px] font-semibold">ルールの設定</h2>
      <label className="block text-[12px] font-medium text-neutral-700">説明<textarea maxLength={1000} className={`${inputClass} mt-2 h-28 py-2`} value={document.description} onChange={(event) => change({ ...document, description: event.target.value })} /></label>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={document.enabled} onChange={(event) => change({ ...document, enabled: event.target.checked })} />公開後にルールを有効にする</label>
      <p className="text-[12px] leading-6 text-secondary">公開済みのルールは、下書きの編集中も現在の設定で動作します。変更は「公開する」を押した後の実行に適用されます。</p>
      <p className="text-[12px] text-secondary">所有者: {initialRule?.owner_name ?? "自分"}</p>
      <div className="border-t border-neutral-200 pt-5"><button type="button" disabled={!draftData && !changed} onClick={() => void discardDraft()} className={`${buttonClass} text-rose-600`}>下書きを破棄</button><p className="mt-2 text-[11px] text-muted">公開済みのルールはそのまま残ります。</p></div>
    </fieldset></div>}
    {palette && <Dialog open onClose={() => setPalette(null)} title="実行することを追加" panelClassName="flex max-h-[80vh] w-[min(540px,94vw)] flex-col rounded-xl bg-surface">
      <div className="border-b border-neutral-200 p-5"><div className="mb-3 flex justify-between"><h2 className="text-[16px] font-semibold">実行することを追加</h2><button aria-label="閉じる" onClick={() => setPalette(null)}>×</button></div><input autoFocus className={inputClass} placeholder="アクションを検索" value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} /></div>
      <div className="overflow-auto p-3">{descriptors.actions.filter((entry) => `${entry.label} ${entry.description}`.includes(paletteQuery)).map((entry) => <button type="button" key={entry.id} onClick={() => chooseAction(entry.id)} className="block w-full rounded-md p-3 text-left hover:bg-neutral-50"><span className="block text-[13px] font-medium">{entry.label}</span><span className="mt-1 block text-[12px] text-muted">{entry.description}{entry.requiresTask && !document.triggers.every((trigger) => hasTaskSubject(trigger.event)) ? "（対象タスクを指定）" : ""}</span></button>)}</div>
    </Dialog>}
    {templatesOpen && <Dialog open onClose={() => setTemplatesOpen(false)} title="テンプレートから作成" panelClassName="w-[min(500px,94vw)] rounded-xl bg-surface p-5">
      <h2 className="mb-3 text-[16px] font-semibold">テンプレートから作成</h2><p className="mb-4 text-[12px] text-secondary">現在のフローを置き換えます。元に戻す操作で復元できます。</p>
      <button type="button" className="mb-2 block w-full rounded-lg border border-neutral-200 p-4 text-left text-[13px] hover:bg-neutral-50" onClick={() => applyTemplate("complete")}>完了時にコメントする</button>
      <button type="button" className="block w-full rounded-lg border border-neutral-200 p-4 text-left text-[13px] hover:bg-neutral-50" onClick={() => applyTemplate("status")}>新規タスクのStatusを設定</button>
      <button type="button" className={`${buttonClass} mt-4`} onClick={() => setTemplatesOpen(false)}>閉じる</button>
    </Dialog>}
    {aiOpen && <Dialog open onClose={() => setAiOpen(false)} title="AIアシスト" panelClassName="w-[min(560px,94vw)] rounded-xl bg-surface p-5">
      <h2 className="text-[16px] font-semibold">AIアシスト</h2><p className="my-3 text-[12px] leading-5 text-secondary">作りたいルールを入力してください。提案を確認してから、下書きへ適用できます。</p>
      <textarea className={`${inputClass} h-24 py-2`} aria-label="作りたいルール" value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="例: タスクが完了したらコメントを追加する" />
      <div className="mt-3 flex gap-2"><button type="button" className={buttonClass} disabled={aiBusy || !aiPrompt.trim()} onClick={() => void suggest()}>{aiBusy ? "提案を作成中…" : "提案を作成"}</button><button type="button" className={buttonClass} onClick={() => setAiOpen(false)}>閉じる</button></div>
      {suggestion && <div className="mt-4 rounded-lg border border-neutral-200 p-4"><p className="text-[13px] font-semibold">{suggestion.name}</p><p className="mt-2 text-[12px] text-secondary">{suggestion.description}</p><p className="mt-3 text-[11px] text-muted">適用すると現在のフローを置き換えます。公開はされません。</p><button type="button" className={`${buttonClass} mt-3`} onClick={() => { change({ ...ruleEditorDraft(suggestion), enabled: document.enabled }); setSelected({ kind: "trigger", index: 0 }); setAiOpen(false); setSuggestion(null); }}>提案を下書きに適用</button></div>}
    </Dialog>}
    {previewOpen && <RulePreviewDialog projectId={project.id} ruleId={ruleId} document={document} descriptors={descriptors} onClose={() => setPreviewOpen(false)} />}
  </div>;
}
