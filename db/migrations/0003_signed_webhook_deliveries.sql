-- Existing unsigned endpoints cannot accept a signed delivery until recreated.
UPDATE automation_webhook_endpoints
SET enabled = FALSE
WHERE btrim(secret) = '';

ALTER TABLE automation_webhook_endpoints
  ADD CONSTRAINT automation_webhook_enabled_requires_secret
  CHECK (NOT enabled OR btrim(secret) <> '');

CREATE TABLE automation_webhook_deliveries (
  endpoint_id BIGINT NOT NULL REFERENCES automation_webhook_endpoints(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (endpoint_id, delivery_id)
);
CREATE INDEX idx_automation_webhook_deliveries_expiry
  ON automation_webhook_deliveries(endpoint_id, received_at);
