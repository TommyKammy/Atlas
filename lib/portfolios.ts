import type { ProjectRule } from "./automation/types";

export type Portfolio = {
  id: number;
  workspace_id: number;
  name: string;
  description: string;
  owner_id: number | null;
  owner_name: string | null;
  project_count: number;
  rule_count: number;
  can_edit: boolean;
  /** Owner/admin editor or an explicitly authorized investment-plan viewer. */
  can_view_plan: boolean;
  created_at: string;
  updated_at: string;
};

export type PortfolioProject = {
  id: number;
  name: string;
  color: string | null;
  icon: string | null;
};

export type PortfolioRule = ProjectRule & {
  portfolio_id: number;
};
