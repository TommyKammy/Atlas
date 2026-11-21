import { scimJsonResponse } from "@/lib/scim/errors";
import { withScimAuth } from "@/lib/scim/route";

export const GET = withScimAuth(async () => scimJsonResponse({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  documentationUri: "/docs/scim.md",
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: 200 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [{
    type: "oauthbearertoken",
    name: "OAuth Bearer Token",
    description: "Issue a token in Atlas workspace security settings and send it as Authorization: Bearer <token>.",
    specUri: "https://www.rfc-editor.org/info/rfc6750",
    primary: true,
  }],
}));
