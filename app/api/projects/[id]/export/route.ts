import { withProject } from "@/lib/api/route";
import { exportProject } from "@/lib/services/project-export";

/** Export a project as CSV or XLSX. */
export const GET = withProject("view", exportProject);
