import { withProject } from "@/lib/api/route";
import { importProject } from "@/lib/services/project-import";

/** Import the CSV dialect produced by the project export route. */
export const POST = withProject("edit", importProject);
