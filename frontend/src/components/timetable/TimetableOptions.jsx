import React from 'react';

const TimetableOptions = ({
  timetableOptions,
  selectedOptionId,
  handleSelectOption
}) => {
  if (timetableOptions.length === 0) return null;

  return (
    <div className="tt-section-card">
      <h3>Generated Options</h3>
      <p className="tt-subtext">
        Generated {timetableOptions.length} unique timetable option{timetableOptions.length === 1 ? "" : "s"}.
        Preview and select the one you want to keep.
      </p>
      <div className="tt-option-grid">
        {timetableOptions.map((option, index) => {
          const isActive = String(option.optionId) === String(selectedOptionId);
          return (
            <button
              key={option.optionId}
              type="button"
              className={`tt-option-card ${isActive ? "is-active" : ""}`}
              onClick={() => handleSelectOption(option.optionId)}
            >
              <span className="tt-option-title">
                {option.label || `Option ${index + 1}`}
              </span>
              <span className="tt-option-meta">
                Objective: {option.objectiveValue ?? "N/A"}
              </span>
              <span className="tt-option-meta">
                Gap Score: {option.score ?? "N/A"}
              </span>
              <span className="tt-option-meta">Seed: {option.seed ?? "N/A"}</span>
              <span className="tt-option-action">
                {isActive ? "Previewing" : "Preview"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TimetableOptions;
