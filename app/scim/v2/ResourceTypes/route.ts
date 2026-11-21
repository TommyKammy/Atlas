import { SCIM_LIST_SCHEMA, SCIM_USER_SCHEMA, scimJsonResponse } from "@/lib/scim/errors";
import { withScimAuth } from "@/lib/scim/route";

export const GET = withScimAuth(async () => scimJsonResponse({
  schemas: [SCIM_LIST_SCHEMA],
  totalResults: 1,
  itemsPerPage: 1,
  startIndex: 1,
  Resources: [{
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
    id: "User",
    name: "User",
    endpoint: "/Users",
    description: "Atlas workspace account",
    schema: SCIM_USER_SCHEMA,
    schemaExtensions: [],
  }],
}));
