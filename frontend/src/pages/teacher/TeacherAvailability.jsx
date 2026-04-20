import React, { useEffect, useMemo, useState } from "react";
import API from "../../api/axios";
import {
  DEFAULT_CONSTRAINT_CONFIG,
  loadConstraintConfig,
  normalizeConstraintConfig,
} from "../constraintConfig";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function normalizeSlots(rawSlots = []) {
  const slots = Array.isArray(rawSlots) ? rawSlots : [];
  const out = [];
  const seen = new Set();

  for (const slot of slots) {
    const day = Number(slot?.day);
    const hour = Number(slot?.hour);
    if (!Number.isInteger(day) || day < 0) continue;
    if (!Number.isInteger(hour) || hour < 0) continue;

    const key = `${day}|${hour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ day, hour });
  }

  return out.sort((a, b) => (a.day - b.day) || (a.hour - b.hour));
}

function toSlotSet(slots = []) {
  return new Set(normalizeSlots(slots).map((slot) => `${slot.day}|${slot.hour}`));
}

const TeacherAvailability = () => {
  const [teachers, setTeachers] = useState([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [selectedSlots, setSelectedSlots] = useState(() => new Set());
  const [savedSlots, setSavedSlots] = useState(() => new Set());
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
  const hoursPerDay = Math.max(1, Number(constraintConfig?.schedule?.hoursPerDay) || 8);
  const breakHours = new Set(
    Array.isArray(constraintConfig?.schedule?.breakHours)
      ? constraintConfig.schedule.breakHours.map((hour) => Number(hour)).filter(Number.isInteger)
      : []
  );

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
          const firstTeacherId = String(nextTeachers[0]._id);
          setSelectedTeacherId(firstTeacherId);
          const initialSlots = toSlotSet(nextTeachers[0].unavailableSlots || []);
          setSelectedSlots(new Set(initialSlots));
          setSavedSlots(new Set(initialSlots));
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
    const nextSlots = toSlotSet(selectedTeacher.unavailableSlots || []);
    setSelectedSlots(new Set(nextSlots));
    setSavedSlots(new Set(nextSlots));
  }, [selectedTeacherId, selectedTeacher]);

  const hasChanges = useMemo(() => {
    if (selectedSlots.size !== savedSlots.size) return true;
    for (const slot of selectedSlots) {
      if (!savedSlots.has(slot)) return true;
    }
    return false;
  }, [savedSlots, selectedSlots]);

  const toggleSlot = (day, hour) => {
    const key = `${day}|${hour}`;
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setMessage("");
    setError("");
  };

  const resetChanges = () => {
    setSelectedSlots(new Set(savedSlots));
    setMessage("");
    setError("");
  };

  const saveAvailability = async () => {
    if (!selectedTeacherId) return;

    try {
      setSaving(true);
      setMessage("");
      setError("");

      const unavailableSlots = Array.from(selectedSlots)
        .map((key) => {
          const [day, hour] = key.split("|").map(Number);
          return { day, hour };
        })
        .sort((a, b) => (a.day - b.day) || (a.hour - b.hour));

      const response = await API.post(`/faculties/${selectedTeacherId}/availability`, {
        unavailableSlots,
      });

      const normalizedSlots = toSlotSet(response.data?.unavailableSlots || unavailableSlots);
      setSelectedSlots(new Set(normalizedSlots));
      setSavedSlots(new Set(normalizedSlots));
      setTeachers((prev) =>
        prev.map((teacher) =>
          String(teacher._id) === String(selectedTeacherId)
            ? { ...teacher, unavailableSlots: response.data?.unavailableSlots || unavailableSlots }
            : teacher
        )
      );
      setMessage("Availability saved.");
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to save availability.");
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
          <h2>Teacher Availability</h2>
          <p className="tt-subtext">
            Mark blocked slots in red. These slots will be rejected in manual editing and respected during generation.
          </p>
        </div>
        <div className="teacher-availability-actions">
          <button className="secondary-btn" onClick={resetChanges} disabled={!hasChanges || saving}>
            Reset
          </button>
          <button className="primary-btn" onClick={saveAvailability} disabled={!selectedTeacherId || !hasChanges || saving}>
            {saving ? "Saving..." : "Save Availability"}
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
        <span>Days: {daysPerWeek}</span>
        <span>Hours: {hoursPerDay}</span>
        <span>Blocked Slots: {selectedSlots.size}</span>
      </div>

      {message ? <div className="success-message">{message}</div> : null}
      {error ? <div className="error-message">{error}</div> : null}

      <div className="teacher-availability-legend">
        <span><strong>Green</strong>: available</span>
        <span><strong>Red</strong>: unavailable</span>
        <span><strong>Gray</strong>: break slot</span>
      </div>

      <div className="table-responsive">
        <table className="styled-table teacher-availability-table">
          <thead>
            <tr>
              <th>Day</th>
              {Array.from({ length: hoursPerDay }).map((_, hour) => (
                <th key={hour}>P{hour + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: daysPerWeek }).map((_, day) => (
              <tr key={day}>
                <td>{DAY_LABELS[day] || `Day ${day + 1}`}</td>
                {Array.from({ length: hoursPerDay }).map((_, hour) => {
                  const key = `${day}|${hour}`;
                  const isBreak = breakHours.has(hour);
                  const isUnavailable = selectedSlots.has(key);
                  const className = [
                    "teacher-availability-cell",
                    isBreak ? "is-break" : isUnavailable ? "is-unavailable" : "is-available",
                  ].join(" ");

                  return (
                    <td key={key}>
                      <button
                        type="button"
                        className={className}
                        onClick={() => !isBreak && toggleSlot(day, hour)}
                        disabled={isBreak}
                      >
                        {isBreak ? "Break" : isUnavailable ? "Blocked" : "Open"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TeacherAvailability;
