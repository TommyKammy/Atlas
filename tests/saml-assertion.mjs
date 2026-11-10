import { randomUUID } from "node:crypto";
import { SignedXml } from "xml-crypto";

function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** Sign a disposable IdP assertion. The test runner generates the PEMs at runtime. */
export function signSamlResponse({ privateKey, publicCert, callbackUrl, audience, email, requestId }) {
  const issueInstant = new Date().toISOString();
  const expires = new Date(Date.now() + 60_000).toISOString();
  const request = xmlEscape(requestId);
  const recipient = xmlEscape(callbackUrl);
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_${randomUUID()}" Version="2.0" IssueInstant="${issueInstant}" InResponseTo="${request}" Destination="${recipient}">
  <saml:Issuer>https://idp.example.test</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion ID="_${randomUUID()}" Version="2.0" IssueInstant="${issueInstant}">
    <saml:Issuer>https://idp.example.test</saml:Issuer>
    <saml:Subject><saml:NameID>${xmlEscape(email)}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData InResponseTo="${request}" Recipient="${recipient}" NotOnOrAfter="${expires}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotOnOrAfter="${expires}"><saml:AudienceRestriction><saml:Audience>${xmlEscape(audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${issueInstant}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>
  </saml:Assertion>
</samlp:Response>`;

  const canonicalizationAlgorithm = "http://www.w3.org/2001/10/xml-exc-c14n#";
  const signer = new SignedXml({
    privateKey,
    publicCert,
    canonicalizationAlgorithm,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
  });
  signer.addReference({
    xpath: "/*[local-name()='Response']/*[local-name()='Assertion']",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", canonicalizationAlgorithm],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  signer.computeSignature(xml, {
    location: { reference: "//*[local-name()='Assertion']/*[local-name()='Issuer']", action: "after" },
  });
  return Buffer.from(signer.getSignedXml()).toString("base64");
}
