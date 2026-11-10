import RuleWorkflowEditor from "@/components/automation/RuleWorkflowEditor";
import { loadRuleEditor } from "@/lib/automation/editor-page";

export const instant = false;

export default async function RuleEditorPage({ params }: { params: Promise<{ id: string; ruleId: string }> }) {
  const { id, ruleId } = await params;
  return <RuleWorkflowEditor {...await loadRuleEditor(Number(id), Number(ruleId))} />;
}
