import RuleWorkflowEditor from "@/components/automation/RuleWorkflowEditor";
import { loadRuleEditor } from "@/lib/automation/editor-page";

export const instant = false;

export default async function NewRulePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ draft?: string }>;
}) {
  const { id } = await params;
  const { draft } = await searchParams;
  return <RuleWorkflowEditor {...await loadRuleEditor(Number(id), undefined, draft)} />;
}
