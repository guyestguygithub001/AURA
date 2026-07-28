const db = require('./database');

/**
 * Audit Logger Service
 * Captures historical events, actions, actors, state modifications, and technical meta parameters.
 */
async function logAuditAction({ actor, action, entityType, entityId, beforeState = null, afterState = null, req = null }) {
  const timestamp = new Date().toISOString();
  const logId = `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Capture client IP and metadata from the Express Request object if available
  let ipAddress = '127.0.0.1';
  let userAgent = 'system';
  if (req) {
    ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    userAgent = req.headers['user-agent'] || 'unknown';
  }

  const logEntry = {
    id: logId,
    actor,
    action,
    entityType,
    entityId,
    beforeState,
    afterState,
    timestamp,
    ipAddress,
    userAgent
  };

  // Add directly to database transaction state
  await db.executeTransaction((state) => {
    state.audit_logs = state.audit_logs || {};
    state.audit_logs[logId] = logEntry;
    return logEntry;
  });

  // Log to platform console for stream listeners
  console.log(`[Audit Trail] [${timestamp}] Actor: ${actor} | Action: ${action} | Entity: ${entityType}:${entityId} | IP: ${ipAddress}`);
  
  return logEntry;
}

module.exports = {
  logAuditAction
};
