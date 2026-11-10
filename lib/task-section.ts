/** Project views can explicitly place a task in no section. */
export function taskSectionId(task: { section_id: number | null; eff_section_id?: number | null }): number | null {
  return task.eff_section_id === undefined ? task.section_id : task.eff_section_id;
}
