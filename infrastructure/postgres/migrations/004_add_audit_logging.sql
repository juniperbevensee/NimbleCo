-- Audit logging for destructive and sensitive operations

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp TIMESTAMP DEFAULT NOW(),
  user_id VARCHAR(255),
  agent_id VARCHAR(100),
  operation VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id VARCHAR(255),
  details JSONB,
  result VARCHAR(20), -- 'success' or 'failure'
  error_message TEXT,
  invocation_id UUID REFERENCES invocations(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_operation ON audit_log(operation);
CREATE INDEX idx_audit_result ON audit_log(result);

COMMENT ON TABLE audit_log IS 'Audit trail for destructive operations (deletes, recursive operations, sensitive data access)';
COMMENT ON COLUMN audit_log.operation IS 'Operation type: delete_file, delete_directory, recursive_delete, read_analytics, etc.';
COMMENT ON COLUMN audit_log.resource_type IS 'Type of resource: file, directory, conversation, etc.';
COMMENT ON COLUMN audit_log.details IS 'JSON details about the operation (paths, counts, etc.)';
