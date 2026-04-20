import React, { useEffect, useMemo, useState } from "react";
import API from "../../api/axios";
import {
  DEFAULT_CONSTRAINT_CONFIG,
  loadConstraintConfig,
  normalizeConstraintConfig,
} from "../constraintConfig";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function normalizePreferences(raw = {}) {
  return {
    avoidFirstPeriod: Boolean(raw?.avoidFirstPeriod),
    avoidLastPeriod: Boolean(raw?.avoidLastPeriod),
    maxConsecutive:
      raw?.maxConsecutive === null || raw?.maxConsecutive === undefined || raw?.maxConsecutive === ""
        ? ""
        : String(raw.maxConsecutive),
    preferredDays: Array.from(
      new Set(
        (Array.isArray(raw?.preferredDays) ? raw.preferredDays : [])
          .map((day) => Number(day))
          .filter((day) => Number.isInteger(day) && day >= 0)
      )
    ).sort((a, b) => a - b),
  };
}

const TeacherPreferences = () => {
  const [teachers, setTeachers] = useState([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [preferences, setPreferences] = useState(() => normalizePreferences({}));
  const [savedPreferences, setSavedPreferences] = useState(() => normalizePreferences({}));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [constraintConfig, setConstraintConfig] = useState(() =>
    normalizeConstraintConfig(DEFAULT_CONSTRAINT_CONFIG)
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await API.get("/timetable-settings");
        const serverConfig = res?.data?.settings?.constraintConfig;
        if (cancelled) return;
        if (serverConfig && typeof serverConfig === "object") {
          setConstraintConfig(normalizeConstraintConfig(serverConfig));
        }
      } catch {
        if (cancelled) return;
        setConstraintConfig(loadConstraintConfig());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
  const daysPerWeek = Math.max(1, Number(constraintConfig?.schedule?.daysPerWeek) || 6);

  const selectedTeacher = useMemo(
    () => teachers.find((teacher) => String(teacher._id) === String(selectedTeacherId)) || null,
    [teachers, selectedTeacherId]
  );

  useEffect(() => {
    const fetchTeachers = async () => {
      try {
        setLoading(true);
        const response = await API.get("/faculties");
        const nextTeachers = Array.isArray(response.data) ? response.data : [];
        setTeachers(nextTeachers);

        if (nextTeachers.length > 0) {
          setSelectedTeacherId(String(nextTeachers[0]._id));
        }
      } catch (err) {
        setError(err?.response?.data?.error || "Failed to load teachers.");
      } finally {
        setLoading(false);
      }
    };

    fetchTeachers();
  }, []);

  useEffect(() => {
    if (!selectedTeacherId || !selectedTeacher) return;
    const next = normalizePreferences(selectedTeacher.preferences || {});
    setPreferences(next);
    setSavedPreferences(next);
  }, [selectedTeacherId, selectedTeacher]);

  const hasChanges = useMemo(
    () => JSON.stringify(preferences) !== JSON.stringify(savedPreferences),
    [preferences, savedPreferences]
  );

  const updateField = (field, value) => {
    setPreferences((prev) => ({ ...prev, [field]: value }));
    setMessage("");
    setError("");
  };

  const togglePreferredDay = (day) => {
    setPreferences((prev) => {
      const nextDays = prev.preferredDays.includes(day)
        ? prev.preferredDays.filter((value) => value !== day)
        : [...prev.preferredDays, day].sort((a, b) => a - b);
      return { ...prev, preferredDays: nextDays };
    });
    setMessage("");
    setError("");
  };

  const resetChanges = () => {
    setPreferences(savedPreferences);
    setMessage("");
    setError("");
  };

  const savePreferences = async () => {
    if (!selectedTeacherId) return;

    try {
      setSaving(true);
      setMessage("");
      setError("");

      const payload = {
        preferences: {
          avoidFirstPeriod: preferences.avoidFirstPeriod,
          avoidLastPeriod: preferences.avoidLastPeriod,
          maxConsecutive:
            preferences.maxConsecutive === "" ? null : Number(preferences.maxConsecutive),
          preferredDays: preferences.preferredDays,
        },
      };

      const response = await API.post(`/faculties/${selectedTeacherId}/preferences`, payload);
      const normalized = normalizePreferences(response.data?.preferences || payload.preferences);
      setPreferences(normalized);
      setSavedPreferences(normalized);
      setTeachers((prev) =>
        prev.map((teacher) =>
          String(teacher._id) === String(selectedTeacherId)
            ? { ...teacher, preferences: response.data?.preferences || payload.preferences }
            : teacher
        )
      );
      setMessage("Preferences saved.");
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="manage-container">Loading...</div>;
  }

  return (
    <div className="manage-container">
      <div className="teacher-availability-header">
        <div>
          <h2>Teacher Preferences</h2>
          <p className="tt-subtext">
            These are soft preferences. Generation will try to satisfy them, but manual editing will still allow exceptions.
          </p>
        </div>
        <div className="teacher-availability-actions">
          <button className="secondary-btn" onClick={resetChanges} disabled={!hasChanges || saving}>
            Reset
          </button>
          <button className="primary-btn" onClick={savePreferences} disabled={!selectedTeacherId || !hasChanges || saving}>
            {saving ? "Saving..." : "Save Preferences"}
          </button>
        </div>
      </div>

      <div className="filters-container teacher-availability-toolbar">
        <label>
          Teacher
          <select
            value={selectedTeacherId}
            onChange={(e) => setSelectedTeacherId(e.target.value)}
          >
            {teachers.map((teacher) => (
              <option key={teacher._id} value={teacher._id}>
                {teacher.name} ({teacher.id})
              </option>
            ))}
          </select>
        </label>
      </div>

      {message ? <div className="success-message">{message}</div> : null}
      {error ? <div className="error-message">{error}</div> : null}

      <div className="teacher-preferences-form">
        <label className="teacher-preferences-toggle">
          <input
            type="checkbox"
            checked={preferences.avoidFirstPeriod}
            onChange={(e) => updateField("avoidFirstPeriod", e.target.checked)}
          />
          <span>Avoid first period</span>
        </label>

        <label className="teacher-preferences-toggle">
          <input
            type="checkbox"
            checked={preferences.avoidLastPeriod}
            onChange={(e) => updateField("avoidLastPeriod", e.target.checked)}
          />
          <span>Avoid last period</span>
        </label>

        <label className="teacher-preferences-number">
          <span>Maximum consecutive classes</span>
          <input
            type="number"
            min="1"
            value={preferences.maxConsecutive}
            onChange={(e) => updateField("maxConsecutive", e.target.value)}
            placeholder="Leave empty for default"
          />
        </label>

        <div className="teacher-preferences-days">
          <div className="teacher-preferences-days-title">Preferred days</div>
          <div className="teacher-preferences-day-grid">
            {Array.from({ length: daysPerWeek }).map((_, day) => (
              <label key={day} className="teacher-preferences-toggle">
                <input
                  type="checkbox"
                  checked={preferences.preferredDays.includes(day)}
                  onChange={() => togglePreferredDay(day)}
                />
                <span>{DAY_LABELS[day] || `Day ${day + 1}`}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeacherPreferences;
