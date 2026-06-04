import React from 'react';

const HealthReport = ({
  healthReport,
  healthSeverityFilter,
  setHealthSeverityFilter,
  isGenerateBlockedByHealth,
  filteredHealthWarnings,
  groupedHealthWarnings
}) => {
  if (!healthReport) return null;

  return (
    <div className="tt-section-card tt-health-card">
      <div className="tt-section-header">
        <h3>Pre-Generation Audit</h3>
        <span className={`tt-status-badge ${healthReport.ok ? "status-ok" : "status-error"}`}>
          {healthReport.ok ? "Passed" : "Action Required"}
        </span>
      </div>
      <p className="tt-subtext">
        Automatic check of your data health before starting the solver.
      </p>
      
      <div className="tt-audit-summary-grid">
         <div className="tt-audit-stat">
            <span className="tt-audit-label">Required Hours</span>
            <span className="tt-audit-value">{healthReport.summary?.totalClassRequiredHours ?? 0}</span>
         </div>
         <div className="tt-audit-stat">
            <span className="tt-audit-label">Total Capacity</span>
            <span className="tt-audit-value">{healthReport.summary?.totalClassCapacityHours ?? 0}</span>
         </div>
         <div className="tt-audit-stat">
            <span className="tt-audit-label">Errors</span>
            <span className={`tt-audit-value ${healthReport.summary?.errors > 0 ? "text-error" : ""}`}>
              {healthReport.summary?.errors ?? 0}
            </span>
         </div>
         <div className="tt-audit-stat">
            <span className="tt-audit-label">Warnings</span>
            <span className={`tt-audit-value ${healthReport.summary?.warnings > 0 ? "text-warning" : ""}`}>
              {healthReport.summary?.warnings ?? 0}
            </span>
         </div>
      </div>

      <div className="filters-container tt-top-gap">
        <select
          value={healthSeverityFilter}
          onChange={(e) => setHealthSeverityFilter(e.target.value)}
        >
          <option value="all">All Issues</option>
          <option value="error">Errors Only</option>
          <option value="warning">Warnings Only</option>
          <option value="info">Info Only</option>
        </select>
      </div>
      {isGenerateBlockedByHealth ? (
        <div className="error-message tt-tight-message">
          Generate is blocked because health check contains errors.
        </div>
      ) : null}
      {filteredHealthWarnings.length > 0 ? (
        <div className="tt-health-list">
          {["error", "warning", "info"].map((severity) => {
            const items = groupedHealthWarnings[severity] || [];
            if (!items.length) return null;
            return (
              <div key={severity} className="tt-health-group">
                <div className="tt-health-title">
                  {severity.toUpperCase()} ({items.length})
                </div>
                {items.map((w, idx) => (
                  <div
                    key={`${w.type || "warning"}-${severity}-${idx}`}
                    className={`tt-health-item tt-health-${severity}`}
                  >
                    <b>{severity.toUpperCase()}</b>: {w.message}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <p style={{ marginTop: 8 }}>No issues detected.</p>
      )}
    </div>
  );
};

export default HealthReport;
