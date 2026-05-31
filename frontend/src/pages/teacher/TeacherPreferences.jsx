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
      <div className="header-with-actions">
        <div>
          <h2>Teacher Preferences</h2>
          <p className="tt-subtext">
            Soft preferences used by the generator to optimize satisfaction.
          </p>
        </div>
        <div className="actions-bar" style={{ marginTop: 0 }}>
          <button className="secondary-btn" onClick={resetChanges} disabled={!hasChanges || saving}>
            Reset Changes
          </button>
          <button className="primary-btn" onClick={savePreferences} disabled={!selectedTeacherId || !hasChanges || saving}>
            {saving ? "Saving..." : "💾 Save Preferences"}
          </button>
        </div>
      </div>

      <div className="filters-container" style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '300px' }}>
          <label style={{ fontWeight: 600, fontSize: '0.875rem' }}>Select Teacher</label>
          <select
            value={selectedTeacherId}
            onChange={(e) => setSelectedTeacherId(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
          >
            {teachers.map((teacher) => (
              <option key={teacher._id} value={teacher._id}>
                {teacher.name} ({teacher.id})
              </option>
            ))}
          </select>
        </div>
      </div>

      {message ? <div className="success-message" style={{ marginBottom: '1.5rem' }}>{message}</div> : null}
      {error ? <div className="error-message" style={{ marginBottom: '1.5rem' }}>{error}</div> : null}

      <div className="preferences-layout" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem' }}>
        <div className="card" style={{ padding: '1.5rem', backgroundColor: 'white', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>Period Preferences</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={preferences.avoidFirstPeriod}
                onChange={(e) => updateField("avoidFirstPeriod", e.target.checked)}
                style={{ width: '1.25rem', height: '1.25rem' }}
              />
              <span style={{ fontWeight: 500 }}>Avoid first period</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={preferences.avoidLastPeriod}
                onChange={(e) => updateField("avoidLastPeriod", e.target.checked)}
                style={{ width: '1.25rem', height: '1.25rem' }}
              />
              <span style={{ fontWeight: 500 }}>Avoid last period</span>
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
              <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Maximum consecutive classes</span>
              <input
                type="number"
                min="1"
                value={preferences.maxConsecutive}
                onChange={(e) => updateField("maxConsecutive", e.target.value)}
                placeholder="Institution Default"
                style={{ padding: '0.625rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>Limit how many classes the teacher can take back-to-back.</p>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '1.5rem', backgroundColor: 'white', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>Preferred Working Days</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>Select days this teacher prefers to be on campus.</p>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '1rem' }}>
            {Array.from({ length: daysPerWeek }).map((_, day) => (
              <label 
                key={day} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem', 
                  cursor: 'pointer',
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  backgroundColor: preferences.preferredDays.includes(day) ? '#eff6ff' : 'white',
                  borderColor: preferences.preferredDays.includes(day) ? 'var(--primary-color)' : 'var(--border-color)',
                  transition: 'all 0.2s'
                }}
              >
                <input
                  type="checkbox"
                  checked={preferences.preferredDays.includes(day)}
                  onChange={() => togglePreferredDay(day)}
                  style={{ width: '1rem', height: '1rem' }}
                />
                <span style={{ fontWeight: 600, color: preferences.preferredDays.includes(day) ? 'var(--primary-color)' : 'inherit' }}>
                  {DAY_LABELS[day] || `Day ${day + 1}`}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeacherPreferences;
