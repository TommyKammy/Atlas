export type ProjectTemplateSectionSummary = {
  name: string;
  task_count: number;
};

/** Lightweight template data used by the project create gallery. */
export type ProjectTemplateSummary = {
  id: number;
  name: string;
  description: string;
  color: string | null;
  icon: string | null;
  created_by: number | null;
  creator_name: string | null;
  created_at: string;
  section_count: number;
  task_count: number;
  sections: ProjectTemplateSectionSummary[];
  sample_tasks: string[];
};
