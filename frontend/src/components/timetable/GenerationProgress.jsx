import React from 'react';

const GenerationProgress = ({
  showGenerationCard,
  taskId,
  stopGeneration,
  canCancelGeneration,
  currentGenerationStatus,
  currentGenerationPhase,
  visibleProgress,
  visibleRemainingSec,
  getProgressMessage,
  formatGenerationStatusLabel,
  formatCountdown,
  generationStatusQuery
}) => {
  if (!showGenerationCard) return null;

  return (
    <div className="tt-job-card">
      <div className="tt-job-card-head">
        <div>
          <h3>Generation Job</h3>
          <p className="tt-subtext">
            Track the active solver run. This continues even if you navigate away and come back.
          </p>
        </div>
        <div className="tt-job-actions">
          {taskId ? <span className="tt-job-badge">Task {String(taskId).slice(-8)}</span> : null}
          <button
            type="button"
            className="secondary-btn"
            onClick={stopGeneration}
            disabled={!canCancelGeneration}
          >
            {generationStatusQuery.data?.cancelRequested ? "Cancel Requested" : "Stop Generation"}
          </button>
        </div>
      </div>
      <div className="filters-container">
        <span>Status: {formatGenerationStatusLabel(currentGenerationStatus)}</span>
        <span>Phase: {formatGenerationStatusLabel(currentGenerationPhase)}</span>
        <span>Progress: {Math.round(visibleProgress)}%</span>
        {visibleRemainingSec != null ? (
          <span>Time Left: {formatCountdown(visibleRemainingSec)}</span>
        ) : null}
      </div>
      <div className="tt-progress-wrap">
        <progress value={visibleProgress} max="100" className="tt-progress-bar" />
        <span>{Math.round(visibleProgress)}%</span>
        <span>{getProgressMessage()}</span>
        {visibleRemainingSec != null && (
          <span>Time Left: {formatCountdown(visibleRemainingSec)}</span>
        )}
      </div>
      {generationStatusQuery.data?.updatedAt ? (
        <p className="tt-subtext">
          Last update: {new Date(generationStatusQuery.data.updatedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
};

export default GenerationProgress;
