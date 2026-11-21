import { SCIM_LIST_SCHEMA, SCIM_USER_SCHEMA, scimJsonResponse } from "@/lib/scim/errors";
import { withScimAuth } from "@/lib/scim/route";

const USER_SCHEMA = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
  id: SCIM_USER_SCHEMA,
  name: "User",
  description: "Atlas workspace account",
  attributes: [
    {
      name: "userName",
      type: "string",
      multiValued: false,
      description: "The IdP sign-in name (for example an Entra UPN). Stored separately from the Atlas email address.",
      required: true,
      caseExact: false,
      mutability: "readWrite",
      returned: "default",
      uniqueness: "server",
    },
    {
      name: "name",
      type: "complex",
      multiValued: false,
      description: "The user's name.",
      required: false,
      mutability: "readWrite",
      returned: "default",
      subAttributes: [
        { name: "formatted", type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
        { name: "givenName", type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
        { name: "familyName", type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
      ],
    },
    { name: "displayName", type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
    {
      name: "emails",
      type: "complex",
      multiValued: true,
      description: "Email addresses. Atlas exposes the account email as the primary work address.",
      required: false,
      mutability: "readWrite",
      returned: "default",
      subAttributes: [
        { name: "value", type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
        { name: "type", type: "string", multiValued: false, required: false, caseExact: true, mutability: "readWrite", returned: "default", uniqueness: "none", canonicalValues: ["work"] },
        { name: "primary", type: "boolean", multiValued: false, required: false, mutability: "readWrite", returned: "default" },
      ],
    },
    { name: "title", type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
    { name: "externalId", type: "string", multiValued: false, required: false, caseExact: true, mutability: "readWrite", returned: "default", uniqueness: "none" },
    { name: "active", type: "boolean", multiValued: false, required: false, mutability: "readWrite", returned: "default" },
    { name: "id", type: "string", multiValued: false, required: false, caseExact: true, mutability: "readOnly", returned: "always", uniqueness: "global" },
    {
      name: "meta",
      type: "complex",
      multiValued: false,
      required: false,
      mutability: "readOnly",
      returned: "default",
      subAttributes: [
        { name: "resourceType", type: "string", multiValued: false, required: false, caseExact: true, mutability: "readOnly", returned: "default", uniqueness: "none" },
        { name: "created", type: "dateTime", multiValued: false, required: false, mutability: "readOnly", returned: "default" },
        { name: "lastModified", type: "dateTime", multiValued: false, required: false, mutability: "readOnly", returned: "default" },
        { name: "location", type: "string", multiValued: false, required: false, mutability: "readOnly", returned: "default" },
      ],
    },
  ],
};

export const GET = withScimAuth(async () => scimJsonResponse({
  schemas: [SCIM_LIST_SCHEMA],
  totalResults: 1,
  itemsPerPage: 1,
  startIndex: 1,
  Resources: [USER_SCHEMA],
}));
