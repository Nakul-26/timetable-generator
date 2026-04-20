import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/axios";
import {
  DEFAULT_CONSTRAINT_CONFIG,
  loadConstraintConfig,
  normalizeConstraintConfig,
} from "./constraintConfig";

const STRENGTH_FACTORS = {
  low: 0.4,
  medium: 0.8,
  high: 1,
  very_high: 1.6,
};

const POLICY_PRESETS = {
  balanced: {
    weeklySubjectHours: { hard: true, shortageWeight: 1000 },
    noGaps: { hard: false, weight: 500 },
    teacherDailyOverload: { enabled: true, max: 6, weight: 120 },
    teacherContinuity: { enabled: true, maxConsecutive: 3, weight: 100 },
    classContinuity: { enabled: true, maxConsecutive: 3, weight: 80 },
    teacherRecoveryBreak: { enabled: true, minHours: 1, hard: false, weight: 140 },
    subjectClustering: { enabled: true, maxPerDay: 3, weight: 50 },
    subjectDistribution: { enabled: true, mode: "spread", weight: 70 },
    highLoadSubjectTiming: { enabled: true, mode: "early", minHoursPerWeek: 4, weight: 60 },
    frontLoading: { enabled: true, weight: 400, transitionWeight: 400, emptyBeforeLaterOccupiedWeight: 400, lateSlotWeight: 400 },
    teacherAvailability: { enabled: true, hard: true, weight: 250 },
    teacherBoundaryPreference: { enabled: false, avoidFirstPeriod: true, avoidLastPeriod: true, weight: 60 },
  },
  strict_academic: {
    weeklySubjectHours: { hard: true, shortageWeight: 1400 },
    noGaps: { hard: true, weight: 500 },
    teacherDailyOverload: { enabled: true, max: 6, weight: 140 },
    teacherContinuity: { enabled: true, maxConsecutive: 3, weight: 130 },
    classContinuity: { enabled: true, maxConsecutive: 3, weight: 120 },
    teacherRecoveryBreak: { enabled: true, minHours: 1, hard: false, weight: 140 },
    subjectClustering: { enabled: true, maxPerDay: 2, weight: 80 },
    subjectDistribution: { enabled: true, mode: "spread", weight: 90 },
    highLoadSubjectTiming: { enabled: true, mode: "early", minHoursPerWeek: 4, weight: 75 },
    frontLoading: { enabled: true, weight: 550, transitionWeight: 550, emptyBeforeLaterOccupiedWeight: 550, lateSlotWeight: 550 },
    teacherAvailability: { enabled: true, hard: true, weight: 250 },
    teacherBoundaryPreference: { enabled: false, avoidFirstPeriod: true, avoidLastPeriod: true, weight: 60 },
  },
  teacher_friendly: {
    weeklySubjectHours: { hard: false, shortageWeight: 1000 },
    noGaps: { hard: false, weight: 350 },
    teacherDailyOverload: { enabled: true, max: 5, weight: 150 },
    teacherContinuity: { enabled: true, maxConsecutive: 2, weight: 130 },
    classContinuity: { enabled: true, maxConsecutive: 3, weight: 80 },
    teacherRecoveryBreak: { enabled: true, minHours: 1, hard: true, weight: 140 },
    subjectClustering: { enabled: true, maxPerDay: 3, weight: 50 },
    subjectDistribution: { enabled: true, mode: "compact", weight: 70 },
    highLoadSubjectTiming: { enabled: false, mode: "early", minHoursPerWeek: 4, weight: 60 },
    frontLoading: { enabled: false, weight: 400, transitionWeight: 400, emptyBeforeLaterOccupiedWeight: 400, lateSlotWeight: 400 },
    teacherAvailability: { enabled: true, hard: true, weight: 250 },
    teacherBoundaryPreference: { enabled: true, avoidFirstPeriod: true, avoidLastPeriod: true, weight: 75 },
  },
};

function toStrength(base, weight) {
  if (!base || base <= 0) return "high";
  const ratio = weight / base;
  const entries = Object.entries(STRENGTH_FACTORS);
  let best = "high";
  let bestDiff = Infinity;
  for (const [k, factor] of entries) {
    const diff = Math.abs(ratio - factor);
    if (diff < bestDiff) {
      best = k;
      bestDiff = diff;
    }
  }
  return best;
}

function fromStrength(base, level) {
  const factor = STRENGTH_FACTORS[level] || 1;
  return Math.max(0, Math.round(base * factor));
}

function parseJsonOrDefault(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function TimetableSettings() {
  const [config, setConfig] = useState(() => normalizeConstraintConfig(DEFAULT_CONSTRAINT_CONFIG));
  const [savedAt, setSavedAt] = useState("");
  const [jsonMode, setJsonMode] = useState(false);
  const [showPolicySettings, setShowPolicySettings] = useState(true);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("custom");
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(normalizeConstraintConfig(DEFAULT_CONSTRAINT_CONFIG), null, 2)
  );
  const [jsonError, setJsonError] = useState("");
  const [availabilityMapText, setAvailabilityMapText] = useState(() =>
    JSON.stringify(normalizeConstraintConfig(DEFAULT_CONSTRAINT_CONFIG).teacherAvailability?.unavailableSlotsByTeacher || {}, null, 2)
  );
  const [globalAvailabilityText, setGlobalAvailabilityText] = useState(() =>
    JSON.stringify(normalizeConstraintConfig(DEFAULT_CONSTRAINT_CONFIG).teacherAvailability?.globallyUnavailableSlots || [], null, 2)
  );
  const [teacherBoundaryOverridesText, setTeacherBoundaryOverridesText] = useState(() =>
    JSON.stringify(normalizeConstraintConfig(DEFAULT_CONSTRAINT_CONFIG).teacherBoundaryPreference?.teacherOverrides || {}, null, 2)
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await api.get("/timetable-settings");
        const serverConfig = res?.data?.settings?.constraintConfig;
        if (cancelled) return;
        if (serverConfig && typeof serverConfig === "object") {
          const normalized = normalizeConstraintConfig(serverConfig);
          setConfig(normalized);
          setJsonText(JSON.stringify(normalized, null, 2));
          setAvailabilityMapText(
            JSON.stringify(normalized.teacherAvailability?.unavailableSlotsByTeacher || {}, null, 2)
          );
          setGlobalAvailabilityText(
            JSON.stringify(normalized.teacherAvailability?.globallyUnavailableSlots || [], null, 2)
          );
          setTeacherBoundaryOverridesText(
            JSON.stringify(normalized.teacherBoundaryPreference?.teacherOverrides || {}, null, 2)
          );
        }
      } catch {
        // Fallback: if DB settings cannot be loaded, use localStorage (legacy).
        const fallback = loadConstraintConfig();
        if (cancelled) return;
        setConfig(fallback);
        setJsonText(JSON.stringify(fallback, null, 2));
        setAvailabilityMapText(
          JSON.stringify(fallback.teacherAvailability?.unavailableSlotsByTeacher || {}, null, 2)
        );
        setGlobalAvailabilityText(
          JSON.stringify(fallback.teacherAvailability?.globallyUnavailableSlots || [], null, 2)
        );
        setTeacherBoundaryOverridesText(
          JSON.stringify(fallback.teacherBoundaryPreference?.teacherOverrides || {}, null, 2)
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const strengths = useMemo(
    () => ({
      teacherContinuity: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.teacherContinuity.weight,
        config.teacherContinuity.weight
      ),
      classContinuity: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.classContinuity.weight,
        config.classContinuity.weight
      ),
      teacherDailyOverload: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.teacherDailyOverload.weight,
        config.teacherDailyOverload.weight
      ),
      teacherRecoveryBreak: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.teacherRecoveryBreak.weight,
        config.teacherRecoveryBreak.weight
      ),
      subjectClustering: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.subjectClustering.weight,
        config.subjectClustering.weight
      ),
      subjectDistribution: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.subjectDistribution.weight,
        config.subjectDistribution.weight
      ),
      highLoadSubjectTiming: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.highLoadSubjectTiming.weight,
        config.highLoadSubjectTiming.weight
      ),
      frontLoading: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.frontLoading.weight,
        config.frontLoading.weight
      ),
      frontLoadingTransition: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.frontLoading.transitionWeight,
        config.frontLoading.transitionWeight
      ),
      frontLoadingEmptyBeforeLater: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.frontLoading.emptyBeforeLaterOccupiedWeight,
        config.frontLoading.emptyBeforeLaterOccupiedWeight
      ),
      frontLoadingLateSlot: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.frontLoading.lateSlotWeight,
        config.frontLoading.lateSlotWeight
      ),
      teacherAvailability: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.teacherAvailability.weight,
        config.teacherAvailability.weight
      ),
      teacherWeeklyLoadBalanceUnder: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.teacherWeeklyLoadBalance.underWeight,
        config.teacherWeeklyLoadBalance.underWeight
      ),
      teacherWeeklyLoadBalanceOver: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.teacherWeeklyLoadBalance.overWeight,
        config.teacherWeeklyLoadBalance.overWeight
      ),
      classDailyMinimumLoad: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.classDailyMinimumLoad.weight,
        config.classDailyMinimumLoad.weight
      ),
      teacherBoundaryPreference: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.teacherBoundaryPreference.weight,
        config.teacherBoundaryPreference.weight
      ),
      noGaps: toStrength(DEFAULT_CONSTRAINT_CONFIG.noGaps.weight, config.noGaps.weight),
      weeklySubjectHours: toStrength(
        DEFAULT_CONSTRAINT_CONFIG.weeklySubjectHours.shortageWeight,
        config.weeklySubjectHours.shortageWeight
      ),
    }),
    [config]
  );

  const updateConfig = (updater) => {
    setSelectedPreset("custom");
    const newConfig = normalizeConstraintConfig(updater(config));
    setConfig(newConfig);
    api.put("/timetable-settings", { constraintConfig: newConfig }).catch(() => {
      /* ignore */
    });
  };

  const applyPreset = (presetKey) => {
    if (!presetKey || presetKey === "custom") {
      setSelectedPreset("custom");
      return;
    }
    const preset = POLICY_PRESETS[presetKey];
    if (!preset) return;
    setConfig((prev) =>
      normalizeConstraintConfig({
        ...prev,
        weeklySubjectHours: { ...prev.weeklySubjectHours, ...(preset.weeklySubjectHours || {}) },
        noGaps: { ...prev.noGaps, ...(preset.noGaps || {}) },
        teacherDailyOverload: { ...prev.teacherDailyOverload, ...(preset.teacherDailyOverload || {}) },
        teacherContinuity: { ...prev.teacherContinuity, ...(preset.teacherContinuity || {}) },
        classContinuity: { ...prev.classContinuity, ...(preset.classContinuity || {}) },
        teacherRecoveryBreak: { ...prev.teacherRecoveryBreak, ...(preset.teacherRecoveryBreak || {}) },
        subjectClustering: { ...prev.subjectClustering, ...(preset.subjectClustering || {}) },
        subjectDistribution: { ...prev.subjectDistribution, ...(preset.subjectDistribution || {}) },
        highLoadSubjectTiming: { ...prev.highLoadSubjectTiming, ...(preset.highLoadSubjectTiming || {}) },
        frontLoading: { ...prev.frontLoading, ...(preset.frontLoading || {}) },
        teacherAvailability: { ...prev.teacherAvailability, ...(preset.teacherAvailability || {}) },
        teacherBoundaryPreference: {
          ...prev.teacherBoundaryPreference,
          ...(preset.teacherBoundaryPreference || {}),
        },
      })
    );
    setSelectedPreset(presetKey);
  };

  const save = () => {
    const normalized = normalizeConstraintConfig(config);
    setConfig(normalized);
    setJsonText(JSON.stringify(normalized, null, 2));
    setAvailabilityMapText(
      JSON.stringify(normalized.teacherAvailability.unavailableSlotsByTeacher || {}, null, 2)
    );
    setGlobalAvailabilityText(
      JSON.stringify(normalized.teacherAvailability.globallyUnavailableSlots || [], null, 2)
    );
    setTeacherBoundaryOverridesText(
      JSON.stringify(normalized.teacherBoundaryPreference.teacherOverrides || {}, null, 2)
    );
    api.put("/timetable-settings", { constraintConfig: normalized }).catch(() => {
      /* ignore */
    });
    setSavedAt(new Date().toLocaleString());
  };

  const resetDefaults = () => {
    const defaults = normalizeConstraintConfig(DEFAULT_CONSTRAINT_CONFIG);
    setConfig(defaults);
    setSelectedPreset("custom");
    setJsonText(JSON.stringify(defaults, null, 2));
    setAvailabilityMapText(
      JSON.stringify(defaults.teacherAvailability.unavailableSlotsByTeacher || {}, null, 2)
    );
    setGlobalAvailabilityText(
      JSON.stringify(defaults.teacherAvailability.globallyUnavailableSlots || [], null, 2)
    );
    setTeacherBoundaryOverridesText(
      JSON.stringify(defaults.teacherBoundaryPreference.teacherOverrides || {}, null, 2)
    );
    setJsonError("");
    api.put("/timetable-settings", { constraintConfig: defaults }).catch(() => {
      /* ignore */
    });
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const normalized = normalizeConstraintConfig(parsed);
      setConfig(normalized);
      setSelectedPreset("custom");
      setAvailabilityMapText(
        JSON.stringify(normalized.teacherAvailability.unavailableSlotsByTeacher || {}, null, 2)
      );
      setGlobalAvailabilityText(
        JSON.stringify(normalized.teacherAvailability.globallyUnavailableSlots || [], null, 2)
      );
      setTeacherBoundaryOverridesText(
        JSON.stringify(normalized.teacherBoundaryPreference.teacherOverrides || {}, null, 2)
      );
      setJsonError("");
    } catch {
      setJsonError("Invalid JSON. Please correct it before applying.");
    }
  };

  return (
    <div className="manage-container tt-settings-page">
      <div className="tt-settings-hero">
        <h2>Timetable Settings</h2>
        <p>
          Start simple: set schedule shape, choose a policy preset, then adjust only what you need.
          Advanced controls are available but hidden by default.
        </p>
      </div>

      <div className="actions-bar tt-settings-actions">
        <button className="primary-btn" onClick={save}>Save Settings</button>
        <button className="secondary-btn" onClick={resetDefaults}>Reset Defaults</button>
        <button className="secondary-btn" onClick={() => setShowAdvancedSettings((v) => !v)}>
          {showAdvancedSettings ? "Hide Advanced Settings" : "Show Advanced Settings"}
        </button>
        <Link className="secondary-btn" to="/timetable">Go To Generate</Link>
      </div>
      {savedAt ? <div className="tt-settings-saved">Saved at: {savedAt}</div> : null}

      <section className="tt-settings-section">
        <h3>Policy Preset</h3>
        <p className="tt-settings-help">
          Presets are the fastest way to configure policies without tuning every solver control.
        </p>
        <div className="filters-container tt-settings-row">
          <label>
            Preset
            <select
              value={selectedPreset}
              onChange={(e) => applyPreset(e.target.value)}
            >
              <option value="balanced">Balanced</option>
              <option value="strict_academic">Strict Academic</option>
              <option value="teacher_friendly">Teacher Friendly</option>
              <option value="custom">Custom (manual tuning)</option>
            </select>
          </label>
          <label>
            Policy Controls
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setShowPolicySettings((v) => !v)}
            >
              {showPolicySettings ? "Hide Policy Settings" : "Show Policy Settings"}
            </button>
          </label>
          <label>
            Expert Controls
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setShowAdvancedSettings((v) => !v)}
            >
              {showAdvancedSettings ? "Hide Advanced" : "Show Advanced"}
            </button>
          </label>
        </div>
      </section>

      <section className="tt-settings-section">
        <h3>What Each Policy Means</h3>
        <p className="tt-settings-help">
          Simple definitions for common timetable rules. Use this as a quick reference.
        </p>
        <div className="tt-settings-glossary">
          <div className="tt-settings-glossary-item">
            <strong>Weekly Subject Hours</strong>
            Total periods each subject must get per week for a class.
          </div>
          <div className="tt-settings-glossary-item">
            <strong>No Gaps Rule</strong>
            Avoid empty periods between two classes on the same day.
          </div>
          <div className="tt-settings-glossary-item">
            <strong>Teacher Weekly Load Balance</strong>
            Keeps each teacher's total weekly periods within a reasonable range.
          </div>
          <div className="tt-settings-glossary-item">
            <strong>Teacher Daily Load</strong>
            Limits how many periods a teacher can take in a single day.
          </div>
          <div className="tt-settings-glossary-item">
            <strong>Teacher Recovery Break</strong>
            Minimum free periods between two classes for the same teacher.
          </div>
          <div className="tt-settings-glossary-item">
            <strong>Class/Teacher Max Consecutive</strong>
            Caps back-to-back periods to reduce overload.
          </div>
          <div className="tt-settings-glossary-item">
            <strong>Subject Clustering</strong>
            Avoids repeating the same subject too many times in one day.
          </div>
          <div className="tt-settings-glossary-item">
            <strong>Subject Distribution</strong>
            Spreads a subject across days or concentrates it into fewer days.
          </div>
          <div className="tt-settings-glossary-item">
            <strong>High-Hour Subject Timing</strong>
            Places heavy subjects earlier or later in the day.
          </div>
          <div className="tt-settings-glossary-item">
            <strong>Front Loading</strong>
            Pushes classes toward earlier slots and leaves later slots freer.
          </div>
          <div className="tt-settings-glossary-item">
            <strong>Teacher Availability</strong>
            Blocks slots where a teacher is not available.
          </div>
          <div className="tt-settings-glossary-item">
            <strong>Boundary Preference</strong>
            Lets teachers avoid first period and/or last period.
          </div>
        </div>
      </section>

      <section className="tt-settings-section">
        <h3>Schedule Basics</h3>
        <p className="tt-settings-help">
          Define timetable shape first. Slot indexes are zero-based, so first period is hour 0.
        </p>
        <div className="filters-container tt-settings-row">
        <label>
          Days Per Week
          <input
            type="number"
            min="1"
            value={config.schedule.daysPerWeek}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                schedule: { ...prev.schedule, daysPerWeek: Number(e.target.value) || 1 },
              }))
            }
          />
        </label>
        <label>
          Hours Per Day
          <input
            type="number"
            min="1"
            value={config.schedule.hoursPerDay}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                schedule: { ...prev.schedule, hoursPerDay: Number(e.target.value) || 1 },
              }))
            }
          />
        </label>
        <label>
          Break Hours (comma separated)
          <input
            type="text"
            value={config.schedule.breakHours.join(",")}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                schedule: {
                  ...prev.schedule,
                  breakHours: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                    .map((v) => Number(v)),
                },
              }))
            }
          />
        </label>
        </div>
        <div className="filters-container tt-settings-row">
        <label>
          Lab Block Size
          <input
            type="number"
            min="1"
            value={config.structural.labBlockSize}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                structural: { ...prev.structural, labBlockSize: Number(e.target.value) || 1 },
              }))
            }
          />
        </label>
        <label>
          Theory Block Size
          <input
            type="number"
            min="1"
            value={config.structural.theoryBlockSize}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                structural: { ...prev.structural, theoryBlockSize: Number(e.target.value) || 1 },
              }))
            }
          />
        </label>
        </div>
      </section>

      {showPolicySettings ? (
      <>
      <section className="tt-settings-section">
        <h3>Core Policies</h3>
        <p className="tt-settings-help">
          Choose strict rules only when mandatory. Soft rules improve flexibility during scheduling.
        </p>
        <div className="filters-container tt-settings-row">
        <label>
          Weekly Subject Hours
          <select
            value={config.weeklySubjectHours.hard ? "hard" : "soft"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                weeklySubjectHours: {
                  ...prev.weeklySubjectHours,
                  hard: e.target.value === "hard",
                },
              }))
            }
          >
            <option value="hard">Hard Enforce</option>
            <option value="soft">Soft Enforce</option>
          </select>
        </label>
        <label>
          Weekly Hours Soft Strength
          <select
            value={strengths.weeklySubjectHours}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                weeklySubjectHours: {
                  ...prev.weeklySubjectHours,
                  shortageWeight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.weeklySubjectHours.shortageWeight,
                    e.target.value
                  ),
                },
              }))
            }
            disabled={config.weeklySubjectHours.hard}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>

        <div className="filters-container tt-settings-row">
        <label>
          No Gaps Rule
          <select
            value={
              config.noGaps.hard ? "hard" : config.noGaps.weight > 0 ? "soft" : "disabled"
            }
            onChange={(e) =>
              updateConfig((prev) => {
                if (e.target.value === "hard") {
                  return { ...prev, noGaps: { ...prev.noGaps, hard: true } };
                }
                if (e.target.value === "soft") {
                  return {
                    ...prev,
                    noGaps: {
                      ...prev.noGaps,
                      hard: false,
                      weight:
                        prev.noGaps.weight > 0
                          ? prev.noGaps.weight
                          : DEFAULT_CONSTRAINT_CONFIG.noGaps.weight,
                    },
                  };
                }
                return { ...prev, noGaps: { ...prev.noGaps, hard: false, weight: 0 } };
              })
            }
          >
            <option value="hard">Hard</option>
            <option value="soft">Soft</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label>
          No Gaps Soft Strength
          <select
            value={strengths.noGaps}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                noGaps: {
                  ...prev.noGaps,
                  weight: fromStrength(DEFAULT_CONSTRAINT_CONFIG.noGaps.weight, e.target.value),
                },
              }))
            }
            disabled={config.noGaps.hard || config.noGaps.weight === 0}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>
      </section>

      <section className="tt-settings-section">
        <h3>Class Schedule Quality And Teacher Comfort</h3>
        <p className="tt-settings-help">
          These controls improve timetable quality: workload balance, subject spread, and comfort.
        </p>
        <div className="filters-container tt-settings-row">
        <label>
          Maximum Periods Per Teacher (Per Day)
          <input
            type="number"
            min="0"
            value={config.teacherDailyOverload.max}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherDailyOverload: {
                  ...prev.teacherDailyOverload,
                  max: Number(e.target.value) || 0,
                },
              }))
            }
          />
        </label>
        <label>
          Teacher Workload Strictness
          <select
            value={strengths.teacherDailyOverload}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherDailyOverload: {
                  ...prev.teacherDailyOverload,
                  weight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.teacherDailyOverload.weight,
                    e.target.value
                  ),
                },
              }))
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>

        <div className="filters-container tt-settings-row">
        <label>
          Maximum Consecutive Classes (Teacher)
          <input
            type="number"
            min="1"
            value={config.teacherContinuity.maxConsecutive}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherContinuity: {
                  ...prev.teacherContinuity,
                  maxConsecutive: Number(e.target.value) || 1,
                },
              }))
            }
          />
        </label>
        <label>
          Consecutive Limit Strictness (Teacher)
          <select
            value={strengths.teacherContinuity}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherContinuity: {
                  ...prev.teacherContinuity,
                  weight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.teacherContinuity.weight,
                    e.target.value
                  ),
                },
              }))
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>

        <div className="filters-container tt-settings-row">
        <label>
          Maximum Consecutive Classes (Class)
          <input
            type="number"
            min="1"
            value={config.classContinuity.maxConsecutive}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                classContinuity: {
                  ...prev.classContinuity,
                  maxConsecutive: Number(e.target.value) || 1,
                },
              }))
            }
          />
        </label>
        <label>
          Consecutive Limit Strictness (Class)
          <select
            value={strengths.classContinuity}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                classContinuity: {
                  ...prev.classContinuity,
                  weight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.classContinuity.weight,
                    e.target.value
                  ),
                },
              }))
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>

        <div className="filters-container tt-settings-row">
        <label>
          Teacher Recovery Break
          <select
            value={config.teacherRecoveryBreak.enabled ? "enabled" : "disabled"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherRecoveryBreak: {
                  ...prev.teacherRecoveryBreak,
                  enabled: e.target.value === "enabled",
                },
              }))
            }
          >
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label>
          Min Free Hours Between Classes
          <input
            type="number"
            min="0"
            value={config.teacherRecoveryBreak.minHours}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherRecoveryBreak: {
                  ...prev.teacherRecoveryBreak,
                  minHours: Number(e.target.value) || 0,
                },
              }))
            }
            disabled={!config.teacherRecoveryBreak.enabled}
          />
        </label>
        <label>
          Recovery Rule Mode
          <select
            value={config.teacherRecoveryBreak.hard ? "hard" : "soft"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherRecoveryBreak: {
                  ...prev.teacherRecoveryBreak,
                  hard: e.target.value === "hard",
                },
              }))
            }
            disabled={!config.teacherRecoveryBreak.enabled}
          >
            <option value="soft">Soft</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <label>
          Recovery Strength
          <select
            value={strengths.teacherRecoveryBreak}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherRecoveryBreak: {
                  ...prev.teacherRecoveryBreak,
                  weight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.teacherRecoveryBreak.weight,
                    e.target.value
                  ),
                },
              }))
            }
            disabled={!config.teacherRecoveryBreak.enabled || config.teacherRecoveryBreak.hard}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>

        <div className="filters-container tt-settings-row">
        <label>
          Subject Max Per Day
          <input
            type="number"
            min="1"
            value={config.subjectClustering.maxPerDay}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                subjectClustering: {
                  ...prev.subjectClustering,
                  maxPerDay: Number(e.target.value) || 1,
                },
              }))
            }
          />
        </label>
        <label>
          Subject Clustering Strength
          <select
            value={strengths.subjectClustering}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                subjectClustering: {
                  ...prev.subjectClustering,
                  weight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.subjectClustering.weight,
                    e.target.value
                  ),
                },
              }))
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>

        <div className="filters-container tt-settings-row">
        <label>
          Subject Week Distribution
          <select
            value={config.subjectDistribution.enabled ? "enabled" : "disabled"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                subjectDistribution: {
                  ...prev.subjectDistribution,
                  enabled: e.target.value === "enabled",
                },
              }))
            }
          >
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label>
          Distribution Mode
          <select
            value={config.subjectDistribution.mode}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                subjectDistribution: {
                  ...prev.subjectDistribution,
                  mode: e.target.value === "compact" ? "compact" : "spread",
                },
              }))
            }
            disabled={!config.subjectDistribution.enabled}
          >
            <option value="spread">Spread Across Week</option>
            <option value="compact">Concentrate Together</option>
          </select>
        </label>
        <label>
          Distribution Strength
          <select
            value={strengths.subjectDistribution}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                subjectDistribution: {
                  ...prev.subjectDistribution,
                  weight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.subjectDistribution.weight,
                    e.target.value
                  ),
                },
              }))
            }
            disabled={!config.subjectDistribution.enabled}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>

        <div className="filters-container tt-settings-row">
        <label>
          High-Hour Subject Timing
          <select
            value={config.highLoadSubjectTiming.enabled ? "enabled" : "disabled"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                highLoadSubjectTiming: {
                  ...prev.highLoadSubjectTiming,
                  enabled: e.target.value === "enabled",
                },
              }))
            }
          >
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label>
          Timing Preference
          <select
            value={config.highLoadSubjectTiming.mode}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                highLoadSubjectTiming: {
                  ...prev.highLoadSubjectTiming,
                  mode: e.target.value === "late" ? "late" : "early",
                },
              }))
            }
            disabled={!config.highLoadSubjectTiming.enabled}
          >
            <option value="early">Prefer Early Periods</option>
            <option value="late">Prefer Late Periods</option>
          </select>
        </label>
        <label>
          Min Hours/Week To Qualify
          <input
            type="number"
            min="1"
            value={config.highLoadSubjectTiming.minHoursPerWeek}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                highLoadSubjectTiming: {
                  ...prev.highLoadSubjectTiming,
                  minHoursPerWeek: Number(e.target.value) || 1,
                },
              }))
            }
            disabled={!config.highLoadSubjectTiming.enabled}
          />
        </label>
        <label>
          Timing Strength
          <select
            value={strengths.highLoadSubjectTiming}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                highLoadSubjectTiming: {
                  ...prev.highLoadSubjectTiming,
                  weight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.highLoadSubjectTiming.weight,
                    e.target.value
                  ),
                },
              }))
            }
            disabled={!config.highLoadSubjectTiming.enabled}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>

        <div className="filters-container tt-settings-row">
        <label>
          Front Loading
          <select
            value={config.frontLoading.enabled ? "enabled" : "disabled"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                frontLoading: {
                  ...prev.frontLoading,
                  enabled: e.target.value === "enabled",
                },
              }))
            }
          >
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label>
          Front Loading Overall Strength
          <select
            value={strengths.frontLoading}
            onChange={(e) =>
              updateConfig((prev) => {
                const weight = fromStrength(
                  DEFAULT_CONSTRAINT_CONFIG.frontLoading.weight,
                  e.target.value
                );
                return {
                  ...prev,
                  frontLoading: {
                    ...prev.frontLoading,
                    weight,
                    transitionWeight: weight,
                    emptyBeforeLaterOccupiedWeight: weight,
                    lateSlotWeight: weight,
                  },
                };
              })
            }
            disabled={!config.frontLoading.enabled}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>

        {showAdvancedSettings ? (
        <div className="filters-container tt-settings-row">
        <label>
          Front Loading Transition Strength
          <select
            value={strengths.frontLoadingTransition}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                frontLoading: {
                  ...prev.frontLoading,
                  transitionWeight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.frontLoading.transitionWeight,
                    e.target.value
                  ),
                },
              }))
            }
            disabled={!config.frontLoading.enabled}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        <label>
          Front Loading Empty-Before-Later Strength
          <select
            value={strengths.frontLoadingEmptyBeforeLater}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                frontLoading: {
                  ...prev.frontLoading,
                  emptyBeforeLaterOccupiedWeight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.frontLoading.emptyBeforeLaterOccupiedWeight,
                    e.target.value
                  ),
                },
              }))
            }
            disabled={!config.frontLoading.enabled}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        <label>
          Front Loading Late-Slot Strength
          <select
            value={strengths.frontLoadingLateSlot}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                frontLoading: {
                  ...prev.frontLoading,
                  lateSlotWeight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.frontLoading.lateSlotWeight,
                    e.target.value
                  ),
                },
              }))
            }
            disabled={!config.frontLoading.enabled}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>
        ) : null}
      </section>

      <section className="tt-settings-section">
        <h3>Teacher Availability</h3>
        <p className="tt-settings-help">
          Enable this to respect teacher leaves and blocked periods.
        </p>
        <div className="filters-container tt-settings-row">
        <label>
          Teacher Availability
          <select
            value={config.teacherAvailability.enabled ? "enabled" : "disabled"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherAvailability: {
                  ...prev.teacherAvailability,
                  enabled: e.target.value === "enabled",
                },
              }))
            }
          >
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label>
          Teacher Availability Mode
          <select
            value={config.teacherAvailability.hard ? "hard" : "soft"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherAvailability: {
                  ...prev.teacherAvailability,
                  hard: e.target.value === "hard",
                },
              }))
            }
            disabled={!config.teacherAvailability.enabled}
          >
            <option value="hard">Hard</option>
            <option value="soft">Soft</option>
          </select>
        </label>
        <label>
          Teacher Availability Strength
          <select
            value={strengths.teacherAvailability}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherAvailability: {
                  ...prev.teacherAvailability,
                  weight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.teacherAvailability.weight,
                    e.target.value
                  ),
                },
              }))
            }
            disabled={!config.teacherAvailability.enabled || config.teacherAvailability.hard}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>

        {showAdvancedSettings ? (
          <>
            <div className="tt-settings-json">
            <label style={{ display: "block", marginBottom: 6 }}>
              {'Global Unavailable Slots JSON ([{ "day": 5, "hour": 0 }])'}
            </label>
            <textarea
              value={globalAvailabilityText}
              onChange={(e) => setGlobalAvailabilityText(e.target.value)}
              onBlur={() =>
                updateConfig((prev) => ({
                  ...prev,
                  teacherAvailability: {
                    ...prev.teacherAvailability,
                    globallyUnavailableSlots: parseJsonOrDefault(globalAvailabilityText, []),
                  },
                }))
              }
              rows={4}
              style={{ width: "100%", fontFamily: "Consolas, Menlo, monospace" }}
            />
              <small>Example: block first period on Saturday with {`[{ "day": 5, "hour": 0 }]`}.</small>
            </div>

            <div className="tt-settings-json">
            <label style={{ display: "block", marginBottom: 6 }}>
              {'Teacher Unavailable Slots Preview'}
            </label>
            <textarea
              value={availabilityMapText}
              rows={6}
              style={{ width: "100%", fontFamily: "Consolas, Menlo, monospace" }}
              readOnly
            />
              <small>Teacher-specific slots now come from the Teacher Availability page. This preview is saved only for reference.</small>
              <div style={{ marginTop: 8 }}>
                <Link className="secondary-btn" to="/teacher-availability">Open Teacher Availability</Link>
              </div>
            </div>
          </>
        ) : (
          <div className="tt-settings-help">
            Advanced availability controls are hidden. Enable Advanced Settings to edit global blocked slots.
          </div>
        )}
      </section>
      </>
      ) : null}

      {showAdvancedSettings ? (
      <>
      <section className="tt-settings-section">
        <h3>Advanced: Weekly Teacher Load</h3>
        <p className="tt-settings-help">
          Keep min, target and max close to realistic workload to reduce impossible schedules.
        </p>
        <div className="filters-container tt-settings-row">
        <label>
          Teacher Weekly Load Balance
          <select
            value={config.teacherWeeklyLoadBalance.enabled ? "enabled" : "disabled"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherWeeklyLoadBalance: {
                  ...prev.teacherWeeklyLoadBalance,
                  enabled: e.target.value === "enabled",
                },
              }))
            }
          >
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label>
          Min Weekly Load
          <input
            type="number"
            min="0"
            value={config.teacherWeeklyLoadBalance.minWeeklyLoad}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherWeeklyLoadBalance: {
                  ...prev.teacherWeeklyLoadBalance,
                  minWeeklyLoad: Number(e.target.value) || 0,
                },
              }))
            }
            disabled={!config.teacherWeeklyLoadBalance.enabled}
          />
        </label>
        <label>
          Target Weekly Load
          <input
            type="number"
            min="0"
            value={config.teacherWeeklyLoadBalance.targetWeeklyLoad}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherWeeklyLoadBalance: {
                  ...prev.teacherWeeklyLoadBalance,
                  targetWeeklyLoad: Number(e.target.value) || 0,
                },
              }))
            }
            disabled={!config.teacherWeeklyLoadBalance.enabled}
          />
        </label>
        <label>
          Max Weekly Load
          <input
            type="number"
            min="0"
            value={config.teacherWeeklyLoadBalance.maxWeeklyLoad}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherWeeklyLoadBalance: {
                  ...prev.teacherWeeklyLoadBalance,
                  maxWeeklyLoad: Number(e.target.value) || 0,
                },
              }))
            }
            disabled={!config.teacherWeeklyLoadBalance.enabled}
          />
        </label>
        </div>

        <div className="filters-container tt-settings-row">
        <label>
          Min Weekly Load Rule
          <select
            value={config.teacherWeeklyLoadBalance.hardMin ? "hard" : "soft"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherWeeklyLoadBalance: {
                  ...prev.teacherWeeklyLoadBalance,
                  hardMin: e.target.value === "hard",
                },
              }))
            }
            disabled={!config.teacherWeeklyLoadBalance.enabled}
          >
            <option value="soft">Soft</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <label>
          Max Weekly Load Rule
          <select
            value={config.teacherWeeklyLoadBalance.hardMax ? "hard" : "soft"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherWeeklyLoadBalance: {
                  ...prev.teacherWeeklyLoadBalance,
                  hardMax: e.target.value === "hard",
                },
              }))
            }
            disabled={!config.teacherWeeklyLoadBalance.enabled}
          >
            <option value="soft">Soft</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <label>
          Underload Strength
          <select
            value={strengths.teacherWeeklyLoadBalanceUnder}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherWeeklyLoadBalance: {
                  ...prev.teacherWeeklyLoadBalance,
                  underWeight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.teacherWeeklyLoadBalance.underWeight,
                    e.target.value
                  ),
                },
              }))
            }
            disabled={!config.teacherWeeklyLoadBalance.enabled || config.teacherWeeklyLoadBalance.hardMin}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        <label>
          Overload Strength
          <select
            value={strengths.teacherWeeklyLoadBalanceOver}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherWeeklyLoadBalance: {
                  ...prev.teacherWeeklyLoadBalance,
                  overWeight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.teacherWeeklyLoadBalance.overWeight,
                    e.target.value
                  ),
                },
              }))
            }
            disabled={!config.teacherWeeklyLoadBalance.enabled || config.teacherWeeklyLoadBalance.hardMax}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>

        <div className="filters-container tt-settings-row">
        <label>
          Class Daily Minimum Load
          <select
            value={config.classDailyMinimumLoad.enabled ? "enabled" : "disabled"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                classDailyMinimumLoad: {
                  ...prev.classDailyMinimumLoad,
                  enabled: e.target.value === "enabled",
                },
              }))
            }
          >
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label>
          Min Slots Per Day
          <input
            type="number"
            min="0"
            value={config.classDailyMinimumLoad.minPerDay}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                classDailyMinimumLoad: {
                  ...prev.classDailyMinimumLoad,
                  minPerDay: Number(e.target.value) || 0,
                },
              }))
            }
            disabled={!config.classDailyMinimumLoad.enabled}
          />
        </label>
        <label>
          Daily Min Mode
          <select
            value={config.classDailyMinimumLoad.hard ? "hard" : "soft"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                classDailyMinimumLoad: {
                  ...prev.classDailyMinimumLoad,
                  hard: e.target.value === "hard",
                },
              }))
            }
            disabled={!config.classDailyMinimumLoad.enabled}
          >
            <option value="soft">Soft</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <label>
          Daily Min Strength
          <select
            value={strengths.classDailyMinimumLoad}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                classDailyMinimumLoad: {
                  ...prev.classDailyMinimumLoad,
                  weight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.classDailyMinimumLoad.weight,
                    e.target.value
                  ),
                },
              }))
            }
            disabled={!config.classDailyMinimumLoad.enabled || config.classDailyMinimumLoad.hard}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>
      </section>

      <section className="tt-settings-section">
        <h3>Advanced: Boundary Preferences</h3>
        <p className="tt-settings-help">
          Use this when some teachers should avoid first/last periods. Add per-teacher overrides
          only if needed.
        </p>
        <div className="filters-container tt-settings-row">
        <label>
          Teacher First/Last Period Preference
          <select
            value={config.teacherBoundaryPreference.enabled ? "enabled" : "disabled"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherBoundaryPreference: {
                  ...prev.teacherBoundaryPreference,
                  enabled: e.target.value === "enabled",
                },
              }))
            }
          >
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label>
          Avoid First Period
          <select
            value={config.teacherBoundaryPreference.avoidFirstPeriod ? "yes" : "no"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherBoundaryPreference: {
                  ...prev.teacherBoundaryPreference,
                  avoidFirstPeriod: e.target.value === "yes",
                },
              }))
            }
            disabled={!config.teacherBoundaryPreference.enabled}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          Avoid Last Period
          <select
            value={config.teacherBoundaryPreference.avoidLastPeriod ? "yes" : "no"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherBoundaryPreference: {
                  ...prev.teacherBoundaryPreference,
                  avoidLastPeriod: e.target.value === "yes",
                },
              }))
            }
            disabled={!config.teacherBoundaryPreference.enabled}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          Boundary Strength
          <select
            value={strengths.teacherBoundaryPreference}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                teacherBoundaryPreference: {
                  ...prev.teacherBoundaryPreference,
                  weight: fromStrength(
                    DEFAULT_CONSTRAINT_CONFIG.teacherBoundaryPreference.weight,
                    e.target.value
                  ),
                },
              }))
            }
            disabled={!config.teacherBoundaryPreference.enabled}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very High</option>
          </select>
        </label>
        </div>

        <div className="tt-settings-json">
        <label style={{ display: "block", marginBottom: 6 }}>
          {'Teacher First/Last Overrides JSON ({"teacherId":{"avoidFirstPeriod":true,"avoidLastPeriod":false}})'}
        </label>
        <textarea
          value={teacherBoundaryOverridesText}
          onChange={(e) => setTeacherBoundaryOverridesText(e.target.value)}
          onBlur={() =>
            updateConfig((prev) => ({
              ...prev,
              teacherBoundaryPreference: {
                ...prev.teacherBoundaryPreference,
                teacherOverrides: parseJsonOrDefault(teacherBoundaryOverridesText, {}),
              },
            }))
          }
          rows={5}
          style={{ width: "100%", fontFamily: "Consolas, Menlo, monospace" }}
        />
          <small>
            Override only exceptions. If a teacher is missing here, global boundary settings apply.
          </small>
        </div>
      </section>

      <section className="tt-settings-section">
        <h3>Advanced: Solver Controls</h3>
        <p className="tt-settings-help">
          Increase solver time only if generation fails frequently or takes too long.
        </p>
        <div className="filters-container tt-settings-row">
        <label>
          Solver Time Limit (seconds)
          <input
            type="number"
            min="1"
            value={config.solver.timeLimitSec}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                solver: { ...prev.solver, timeLimitSec: Number(e.target.value) || 1 },
              }))
            }
          />
        </label>
        <label>
          Generated Options Count
          <input
            type="number"
            min="1"
            max="5"
            value={config.solver.solutionCount}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                solver: {
                  ...prev.solver,
                  solutionCount: Math.max(1, Math.min(5, Number(e.target.value) || 1)),
                },
              }))
            }
          />
        </label>
        <label>
          Max Candidates Per Combo
          <input
            type="number"
            min="1"
            value={config.solver.maxCandidatesPerCombo}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                solver: {
                  ...prev.solver,
                  maxCandidatesPerCombo: Math.max(1, Number(e.target.value) || 1),
                },
              }))
            }
          />
        </label>
        <label>
          Early Abort If No Solution
          <select
            value={config.solver.earlyAbortNoSolution ? "yes" : "no"}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                solver: {
                  ...prev.solver,
                  earlyAbortNoSolution: e.target.value === "yes",
                },
              }))
            }
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        </div>
        <div className="filters-container tt-settings-row">
        <label>
          No-Solution Abort Ratio
          <input
            type="number"
            min="0"
            max="0.95"
            step="0.01"
            value={config.solver.noSolutionAbortRatio}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                solver: {
                  ...prev.solver,
                  noSolutionAbortRatio: Math.max(0, Math.min(0.95, Number(e.target.value) || 0)),
                },
              }))
            }
          />
        </label>
        <label>
          No-Solution Abort Min Seconds
          <input
            type="number"
            min="1"
            step="1"
            value={config.solver.noSolutionAbortMinSec}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                solver: {
                  ...prev.solver,
                  noSolutionAbortMinSec: Math.max(1, Number(e.target.value) || 1),
                },
              }))
            }
          />
        </label>
        <label>
          Min Time Per Attempt (seconds)
          <input
            type="number"
            min="5"
            step="1"
            value={config.solver.minTimePerAttemptSec}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                solver: {
                  ...prev.solver,
                  minTimePerAttemptSec: Math.max(5, Number(e.target.value) || 5),
                },
              }))
            }
          />
        </label>
        <label>
          Min Difference Ratio Between Options
          <input
            type="number"
            min="0"
            max="0.25"
            step="0.01"
            value={config.solver.minCandidateDifferenceRatio}
            onChange={(e) =>
              updateConfig((prev) => ({
                ...prev,
                solver: {
                  ...prev.solver,
                  minCandidateDifferenceRatio: Math.max(
                    0,
                    Math.min(0.25, Number(e.target.value) || 0)
                  ),
                },
              }))
            }
          />
        </label>
        </div>
        <div className="actions-bar tt-settings-actions" style={{ marginTop: 8 }}>
          <button className="secondary-btn" onClick={() => setJsonMode((v) => !v)}>
            {jsonMode ? "Hide Advanced JSON" : "Show Advanced JSON"}
          </button>
        </div>
      </section>

      {jsonMode ? (
        <section className="tt-settings-section">
          <h3>Advanced JSON</h3>
          <p className="tt-settings-help">
            Advanced mode exposes raw numeric weights. Use only for expert tuning.
          </p>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={16}
            style={{ width: "100%", fontFamily: "Consolas, Menlo, monospace" }}
          />
          <div className="actions-bar" style={{ marginTop: 8 }}>
            <button className="secondary-btn" onClick={applyJson}>Apply JSON</button>
            <button
              className="secondary-btn"
              onClick={() => setJsonText(JSON.stringify(config, null, 2))}
            >
              Refresh JSON From Form
            </button>
          </div>
          {jsonError ? <div className="error-message">{jsonError}</div> : null}
        </section>
      ) : null}
      </>
      ) : null}
    </div>
  );
}

export default TimetableSettings;
