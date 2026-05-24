import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../api/axios";
import axios from "../api/axios";
import { DEFAULT_CONSTRAINT_CONFIG, loadConstraintConfig, normalizeConstraintConfig } from "./constraintConfig";
import { getComboSubjectDisplayName } from "./subjectDisplay";

const HEALTH_BLOCK_STORAGE_KEY = "timetable.blockGenerateOnHealthErrors";
const ACTIVE_GENERATION_TASK_KEY = "timetable.activeGenerationTaskId";
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };
const GENERATION_STATUS_POLL_MS = Math.max(
  1000,
  Number(import.meta.env.VITE_GENERATION_STATUS_POLL_MS) || 3000
);
const HEALTH_ERROR_PREVIEW_LIMIT = 3;
const TERMINAL_GENERATION_STATUSES = new Set(["completed", "failed", "cancelled", "error"]);
const ACTIVE_GENERATION_STATUSES = new Set(["pending", "running"]);

const isTerminalGenerationStatus = (status) =>
  TERMINAL_GENERATION_STATUSES.has(String(status || "").toLowerCase());

const isActiveGenerationStatus = (status) =>
  ACTIVE_GENERATION_STATUSES.has(String(status || "").toLowerCase());

function Timetable() {
  const [loading, setLoading] = useState(false);
  const [timetable, setTimetable] = useState(null);
  const [timetableOptions, setTimetableOptions] = useState([]);
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [error, setError] = useState("");
  const [bestScore, setBestScore] = useState(null);
  const [objectiveValue, setObjectiveValue] = useState(null);
  const [facultyDailyHours, setFacultyDailyHours] = useState(null);

  // Async generation
  const [taskId, setTaskId] = useState(null);
  const [cancelRequestedLocally, setCancelRequestedLocally] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressTarget, setProgressTarget] = useState(0);
  const [progressPhase, setProgressPhase] = useState("idle");
  const [solverDeadlineAt, setSolverDeadlineAt] = useState(null);
  const [solverRemainingSec, setSolverRemainingSec] = useState(null);
  const progressRef = useRef(0);
  const settingsHydratedRef = useRef(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthReport, setHealthReport] = useState(null);
  const [healthSeverityFilter, setHealthSeverityFilter] = useState("all");
  const [blockGenerateOnHealthErrors, setBlockGenerateOnHealthErrors] = useState(() => {
    // Default to false; we will hydrate from DB settings.
    return false;
  });

  // Master data
  const [classes, setClasses] = useState([]);
  const [faculties, setFaculties] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [combos, setCombos] = useState([]);
  const [fixedSlotCombos, setFixedSlotCombos] = useState([]);
  const [classSubjects, setClassSubjects] = useState([]);

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedFaculty, setSelectedFaculty] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [displayMode, setDisplayMode] = useState("class");

  // Fixed slots
  const [fixedSlots, setFixedSlots] = useState({});
  const [fixedClassId, setFixedClassId] = useState("");
  const [showFixedClasses, setShowFixedClasses] = useState(false);
  const [constraintConfig, setConstraintConfig] = useState(() => normalizeConstraintConfig(DEFAULT_CONSTRAINT_CONFIG));
  const DAYS_PER_WEEK = Number(constraintConfig?.schedule?.daysPerWeek) || 6;
  const HOURS_PER_DAY = Number(constraintConfig?.schedule?.hoursPerDay) || 8;

  const classById = useMemo(() => new Map(classes.map((c) => [String(c._id), c])), [classes]);
  const facultyById = useMemo(
    () => new Map(faculties.map((f) => [String(f._id), f])),
    [faculties]
  );
  const subjectById = useMemo(
    () => new Map(subjects.map((s) => [String(s._id), s])),
    [subjects]
  );
  const comboById = useMemo(
    () => new Map(combos.map((c) => [String(c._id), c])),
    [combos]
  );

  // Hydrate settings from DB once when the page loads.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await api.get("/timetable-settings");
        const settings = res?.data?.settings || null;
        if (cancelled || !settings) return;

        if (typeof settings.blockGenerateOnHealthErrors === "boolean") {
          setBlockGenerateOnHealthErrors(settings.blockGenerateOnHealthErrors);
        }
        if (settings.constraintConfig && typeof settings.constraintConfig === "object") {
          setConstraintConfig(normalizeConstraintConfig(settings.constraintConfig));
        }
        if (settings.fixedSlots && typeof settings.fixedSlots === "object") {
          setFixedSlots(settings.fixedSlots);
        }
      } catch {
        // Fallback: keep existing behavior for local dev/offline.
        try {
          const raw = window.localStorage.getItem(HEALTH_BLOCK_STORAGE_KEY);
          if (raw === "true" || raw === "false") {
            setBlockGenerateOnHealthErrors(raw === "true");
          }
          setConstraintConfig(loadConstraintConfig());
        } catch {
          /* ignore */
        }
      } finally {
        settingsHydratedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist settings to DB (debounced) so navigation/device changes keep the same config.
  const settingsSaveTimerRef = useRef(null);
  useEffect(() => {
    if (!settingsHydratedRef.current) return;

    if (settingsSaveTimerRef.current) {
      window.clearTimeout(settingsSaveTimerRef.current);
    }

    settingsSaveTimerRef.current = window.setTimeout(() => {
      api.put("/timetable-settings", {
        constraintConfig,
        blockGenerateOnHealthErrors,
        fixedSlots,
      }).catch(() => {
        // Ignore save failures; the app should remain usable.
      });
    }, 500);

    return () => {
      if (settingsSaveTimerRef.current) {
        window.clearTimeout(settingsSaveTimerRef.current);
      }
    };
  }, [blockGenerateOnHealthErrors, constraintConfig, fixedSlots]);

  // Resume an in-progress generation when returning to this page.
  useEffect(() => {
    if (taskId) return;
    setCancelRequestedLocally(false);
    try {
      const savedTaskId = window.localStorage.getItem(ACTIVE_GENERATION_TASK_KEY);
      if (!savedTaskId) return;
      setTaskId(savedTaskId);
      setLoading(true);
      setError("");
      setProgressPhase("queued");
    } catch {
      /* ignore */
    }
  }, [taskId]);
  const requiredHoursByClassSubject = useMemo(() => {
    const byClass = new Map();
    for (const item of classSubjects) {
      const classId = String(item?.class?._id || item?.class || "");
      const subjectId = String(item?.subject?._id || item?.subject || "");
      const hours = Number(item?.hoursPerWeek || 0);
      if (!classId || !subjectId) continue;
      if (!byClass.has(classId)) byClass.set(classId, {});
      byClass.get(classId)[subjectId] = hours;
    }
    return byClass;
  }, [classSubjects]);
  const fixedClassComboOptionsByClass = useMemo(() => {
    const out = new Map();
    const allClassIds = classes.map((c) => String(c._id));

    for (const classId of allClassIds) {
      const classOptions = [];
      for (const combo of fixedSlotCombos) {
        const classIds = Array.isArray(combo.class_ids)
          ? combo.class_ids.map((id) => String(id))
          : [];
        const appliesToClass = classIds.length === 0 || classIds.includes(classId);
        if (!appliesToClass) continue;

        const subjectName = getComboSubjectDisplayName(combo, subjectById, "N/A");
        const comboSubjectType = String(
          combo?.subject?.type || subjectById.get(String(combo.subject_id))?.type || ""
        ).toLowerCase();
        const facultyNames = (Array.isArray(combo.faculty_ids) ? combo.faculty_ids : [])
          .map((fid) => facultyById.get(String(fid))?.name || "N/A")
          .join(" & ");
        const facultyLabel =
          facultyNames || (comboSubjectType === "no_teacher" ? "No Teacher" : "N/A");

        classOptions.push({
          id: String(combo._id),
          label: `${facultyLabel} : ${subjectName}`,
        });
      }
      out.set(classId, classOptions);
    }

    return out;
  }, [classes, fixedSlotCombos, subjectById, facultyById]);

  const normalizeTableShape = useCallback((table) => {
    if (!table || typeof table !== "object") return null;
    const out = {};
    for (const [classId, days] of Object.entries(table)) {
      if (Array.isArray(days)) {
        out[classId] = days;
        continue;
      }
      if (days && typeof days === "object") {
        const orderedDays = Object.keys(days)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => {
            const row = days[k];
            if (Array.isArray(row)) return row;
            if (row && typeof row === "object") {
              return Object.keys(row)
                .sort((a, b) => Number(a) - Number(b))
                .map((h) => row[h]);
            }
            return [];
          });
        out[classId] = orderedDays;
      }
    }
    return out;
  }, []);

  const normalizeGenerationResult = useCallback((raw) => {
    if (!raw) return null;
    const payload = raw.result && typeof raw.result === "object" ? raw.result : raw;
    const normalizeOption = (option, index) => {
      if (!option || typeof option !== "object") return null;
      const optionClassTimetables =
        option.class_timetables ??
        option.bestClassTimetables ??
        option.partialData?.class_timetables ??
        null;
      const optionFacultyTimetables =
        option.faculty_timetables ??
        option.bestFacultyTimetables ??
        option.partialData?.faculty_timetables ??
        null;

      return {
        ...option,
        optionId: String(option.optionId || option.option_id || `option-${index + 1}`),
        label: option.label || `Option ${index + 1}`,
        rank: Number(option.rank || index + 1),
        class_timetables: normalizeTableShape(optionClassTimetables),
        faculty_timetables: normalizeTableShape(optionFacultyTimetables),
      };
    };

    const normalizedOptions = Array.isArray(payload.generation_options)
      ? payload.generation_options.map(normalizeOption).filter(Boolean)
      : [];
    const selectedOption =
      normalizedOptions.find(
        (option) => String(option.optionId) === String(payload.selected_option_id || "")
      ) ||
      normalizedOptions[0] ||
      null;
    const classTimetables = payload.class_timetables ?? payload.bestClassTimetables ?? selectedOption?.class_timetables ?? null;
    const facultyTimetables =
      payload.faculty_timetables ??
      payload.bestFacultyTimetables ??
      selectedOption?.faculty_timetables ??
      null;

    return {
      ...payload,
      selected_option_id: payload.selected_option_id || selectedOption?.optionId || "",
      generation_options: normalizedOptions,
      class_timetables: normalizeTableShape(classTimetables),
      faculty_timetables: normalizeTableShape(facultyTimetables),
    };
  }, [normalizeTableShape]);

  const hasRenderableTable = useCallback((table) => {
    return !!table && typeof table === "object" && Object.keys(table).length > 0;
  }, []);

  const hasRenderableTimetable = useCallback((data) => {
    return hasRenderableTable(data?.class_timetables);
  }, [hasRenderableTable]);

  const applyTimetableState = useCallback((raw, preferredOptionId = null) => {
    const normalized = normalizeGenerationResult(raw);
    if (!normalized) return null;
    if (normalized.ok === false) {
      const canRenderFailurePreview = hasRenderableTimetable(normalized);
      setTimetable(canRenderFailurePreview ? normalized : null);
      setTimetableOptions([]);
      setSelectedOptionId("");
      setBestScore(null);
      setObjectiveValue(null);
      setFacultyDailyHours(canRenderFailurePreview ? normalized?.faculty_daily_hours ?? null : null);
      if (canRenderFailurePreview && normalized?.classes) {
        setClasses(normalized.classes);
      }
      if (canRenderFailurePreview && normalized?.subjects) {
        setSubjects(normalized.subjects);
      }
      if (canRenderFailurePreview && normalized?.faculties) {
        setFaculties(normalized.faculties);
      }
      if (canRenderFailurePreview && normalized?.combos) {
        setCombos(normalized.combos);
      }
      return normalized;
    }

    const options = Array.isArray(normalized.generation_options)
      ? normalized.generation_options.filter(hasRenderableTimetable)
      : [];
    const selectedOption =
      options.find(
        (option) =>
          String(option.optionId) ===
          String(preferredOptionId || normalized.selected_option_id || "")
      ) ||
      options[0] ||
      null;
    const active = selectedOption
      ? {
          ...normalized,
          ...selectedOption,
          selected_option_id: selectedOption.optionId,
          class_timetables: selectedOption.class_timetables,
          faculty_timetables: selectedOption.faculty_timetables,
          faculty_daily_hours:
            selectedOption.faculty_daily_hours ?? normalized.faculty_daily_hours ?? null,
          score: selectedOption.score ?? normalized.score ?? null,
          objectiveValue: selectedOption.objectiveValue ?? normalized.objectiveValue ?? null,
        }
      : normalized;
    setTimetable(hasRenderableTimetable(active) ? active : normalized);
    setTimetableOptions(options);
    setSelectedOptionId(selectedOption?.optionId || normalized.selected_option_id || "");
    setBestScore(active?.score ?? null);
    setObjectiveValue(active?.objectiveValue ?? active?.objective_value ?? null);
    setFacultyDailyHours(active?.faculty_daily_hours ?? null);
    if (active?.classes) {
      setClasses(active.classes);
    }
    if (active?.subjects) {
      setSubjects(active.subjects);
    }
    if (active?.faculties) {
      setFaculties(active.faculties);
    }
    if (active?.combos) {
      setCombos(active.combos);
    }
    return active;
  }, [hasRenderableTimetable, normalizeGenerationResult]);

  /* ===================== DATA FETCH ===================== */

  const fetchAll = useCallback(async () => {
    try {
      const [classRes, facRes, subRes, comboRes, classSubjectRes, fixedComboRes] = await Promise.all([
        axios.get("/classes"),
        axios.get("/faculties"),
        axios.get("/subjects"),
        axios.get("/teacher-subject-combos"),
        axios.get("/class-subjects"),
        api.get("/fixed-slot-combos"),
      ]);
      setClasses(classRes.data);
      setFaculties(facRes.data);
      setSubjects(subRes.data);
      setCombos(comboRes.data || []);
      setClassSubjects(classSubjectRes.data || []);
      setFixedSlotCombos(fixedComboRes.data?.combos || []);
    } catch {
      setError("Failed to fetch master data.");
    }
  }, []);

  const fetchLatest = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/result/latest");
      if (res.data) {
        applyTimetableState(res.data);
      } else {
        setTimetable(null);
        setTimetableOptions([]);
        setSelectedOptionId("");
      }
    } catch {
      setError("Failed to fetch latest timetable.");
    }
    setLoading(false);
  }, [applyTimetableState]);

  useEffect(() => {
    fetchAll();
    fetchLatest();
  }, [fetchAll, fetchLatest]);

  useEffect(() => {
    let cancelled = false;

    const refreshSettingsFromServer = async () => {
      try {
        const res = await api.get("/timetable-settings");
        const settings = res?.data?.settings || null;
        if (cancelled || !settings) return;
        if (typeof settings.blockGenerateOnHealthErrors === "boolean") {
          setBlockGenerateOnHealthErrors(settings.blockGenerateOnHealthErrors);
        }
        if (settings.constraintConfig && typeof settings.constraintConfig === "object") {
          setConstraintConfig(normalizeConstraintConfig(settings.constraintConfig));
        }
        if (settings.fixedSlots && typeof settings.fixedSlots === "object") {
          setFixedSlots(settings.fixedSlots);
        }
      } catch {
        /* ignore */
      }
    };

    const onFocus = () => {
      refreshSettingsFromServer();
    };

    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!fixedClassId && classes.length > 0) {
      setFixedClassId(String(classes[0]._id));
    }
  }, [classes, fixedClassId]);

  useEffect(() => {
    if (displayMode === "faculty" && !hasRenderableTable(timetable?.faculty_timetables)) {
      setDisplayMode("class");
    }
  }, [displayMode, hasRenderableTable, timetable]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (!solverDeadlineAt || (!loading && !taskId)) {
      setSolverRemainingSec(null);
      return;
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((solverDeadlineAt - Date.now()) / 1000));
      setSolverRemainingSec(remaining);
    };

    updateRemaining();
    const timerId = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timerId);
  }, [loading, solverDeadlineAt, taskId]);

  useEffect(() => {
    if (!loading) {
      setProgress(progressTarget);
      return;
    }

    const startValue = progressRef.current;
    if (Math.abs(progressTarget - startValue) < 1) {
      if (startValue !== progressTarget) setProgress(progressTarget);
      return;
    }

    let frameId = null;
    const delta = progressTarget - startValue;
    const durationMs = Math.max(
      900,
      Math.min(
        Math.max(1200, GENERATION_STATUS_POLL_MS - 200),
        2600
      )
    );
    const startedAt = performance.now();

    const step = (now) => {
      const elapsed = now - startedAt;
      const ratio = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - ratio, 3);
      const nextValue = startValue + delta * eased;
      progressRef.current = nextValue;
      setProgress(nextValue);
      if (ratio < 1) {
        frameId = window.requestAnimationFrame(step);
      }
    };

    frameId = window.requestAnimationFrame(step);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [loading, progressTarget]);

  const sortedHealthWarnings = useMemo(() => {
    const list = Array.isArray(healthReport?.warnings) ? [...healthReport.warnings] : [];
    return list.sort((a, b) => {
      const sa = String(a?.severity || "warning").toLowerCase();
      const sb = String(b?.severity || "warning").toLowerCase();
      const ra = SEVERITY_RANK[sa] ?? 9;
      const rb = SEVERITY_RANK[sb] ?? 9;
      if (ra !== rb) return ra - rb;
      return String(a?.message || "").localeCompare(String(b?.message || ""));
    });
  }, [healthReport]);

  const filteredHealthWarnings = useMemo(() => {
    if (healthSeverityFilter === "all") return sortedHealthWarnings;
    return sortedHealthWarnings.filter(
      (w) => String(w?.severity || "warning").toLowerCase() === healthSeverityFilter
    );
  }, [sortedHealthWarnings, healthSeverityFilter]);

  const groupedHealthWarnings = useMemo(() => {
    const out = { error: [], warning: [], info: [] };
    for (const w of filteredHealthWarnings) {
      const s = String(w?.severity || "warning").toLowerCase();
      if (!out[s]) out[s] = [];
      out[s].push(w);
    }
    return out;
  }, [filteredHealthWarnings]);

  const healthErrorsCount = Number(healthReport?.summary?.errors || 0);
  const isGenerateBlockedByHealth =
    blockGenerateOnHealthErrors && healthReport && healthErrorsCount > 0;

  const summarizeHealthIssues = useCallback((report) => {
    if (!report || !Array.isArray(report.warnings)) return "";
    const topErrors = report.warnings
      .filter((item) => String(item?.severity || "").toLowerCase() === "error")
      .slice(0, HEALTH_ERROR_PREVIEW_LIMIT)
      .map((item) => item.message)
      .filter(Boolean);

    if (!topErrors.length) return "";
    return `Health check found blocking issues: ${topErrors.join(" | ")}`;
  }, []);

  const buildGenerationFailureMessage = useCallback((message, report = null) => {
    const baseMessage = String(message || "Generation failed").trim();
    const healthSummary = summarizeHealthIssues(report);
    return healthSummary ? `${baseMessage}. ${healthSummary}` : baseMessage;
  }, [summarizeHealthIssues]);

  const formatFailureDetails = useCallback((data) => {
    if (!data || typeof data !== "object") return "";

    const parts = [];
    const reason = String(data.reason || "").trim();
    const hint = String(data.hint || "").trim();

    if (reason) {
      parts.push(`Reason: ${reason}`);
    }
    if (hint) {
      parts.push(`Hint: ${hint}`);
    }

    const unmet = Array.isArray(data.unmet_requirements)
      ? data.unmet_requirements
          .map((item) => {
            const label = item?.label || item?.name || item?.subject || item?.class || item?.message;
            const detail = item?.detail || item?.reason || item?.type;
            if (label && detail) return `${label} (${detail})`;
            return label || detail || null;
          })
          .filter(Boolean)
          .slice(0, 4)
      : [];

    if (unmet.length > 0) {
      parts.push(`Unmet requirements: ${unmet.join("; ")}`);
    }

    const diagnostics = data.diagnostics;
    if (diagnostics && typeof diagnostics === "object") {
      const diagParts = [];
      if (Array.isArray(diagnostics.blockers) && diagnostics.blockers.length > 0) {
        diagParts.push(`Blockers: ${diagnostics.blockers.slice(0, 3).join("; ")}`);
      }
      if (Array.isArray(diagnostics.issues) && diagnostics.issues.length > 0) {
        diagParts.push(`Issues: ${diagnostics.issues.slice(0, 3).join("; ")}`);
      }
      if (diagnostics.summary && typeof diagnostics.summary === "string") {
        diagParts.push(diagnostics.summary);
      }
      if (diagParts.length > 0) {
        parts.push(...diagParts);
      }
    } else if (Array.isArray(diagnostics) && diagnostics.length > 0) {
      parts.push(`Diagnostics: ${diagnostics.slice(0, 3).join("; ")}`);
    }

    return parts.join(" | ");
  }, []);

  const requestHealthCheck = useCallback(async (latestConstraintConfig) => {
    const payload = transformFixedSlots(fixedSlots);
    const res = await api.post("/health-check", {
      fixedSlots: payload,
      constraintConfig: latestConstraintConfig,
    });
    return res.data || null;
  }, [fixedSlots]);

  /* ===================== POLLING ===================== */

  const generationStatusQuery = useQuery({
    queryKey: ["generation-status", taskId],
    queryFn: async () => {
      const res = await api.get(`/generation-status/${taskId}`);
      return res.data || null;
    },
    enabled: Boolean(taskId),
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    retry: 2,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const cancelRequested = query.state.data?.cancelRequested || cancelRequestedLocally;
      return taskId && !cancelRequested && !isTerminalGenerationStatus(status)
        ? GENERATION_STATUS_POLL_MS
        : false;
    },
  });

  useEffect(() => {
    if (!taskId || !generationStatusQuery.error) return;

    const status = Number(generationStatusQuery.error?.response?.status || 0);
    if (status === 404) {
      setLoading(false);
      setTaskId(null);
      setProgressPhase("idle");
      setSolverDeadlineAt(null);
      setSolverRemainingSec(null);
      try {
        window.localStorage.removeItem(ACTIVE_GENERATION_TASK_KEY);
      } catch {
        /* ignore */
      }
      return;
    }

    setProgressPhase("reconnecting");
    if ((generationStatusQuery.failureCount || 0) >= 2) {
      setError("Temporarily lost connection to the server. Retrying...");
    }
  }, [generationStatusQuery.error, generationStatusQuery.failureCount, taskId]);

  useEffect(() => {
    if (!taskId || !generationStatusQuery.data) return;

    const {
      status,
      progress: nextProgress,
      phase,
      result,
      error: jobError,
      partialData,
      cancelRequested,
      deadlineAt,
    } = generationStatusQuery.data;

    if (!status) return;

    if (deadlineAt) {
      const nextDeadline = new Date(deadlineAt).getTime();
      if (Number.isFinite(nextDeadline) && nextDeadline > 0) {
        setSolverDeadlineAt(nextDeadline);
      }
    }

    if (generationStatusQuery.isFetched) {
      setError("");
    }

    if (isActiveGenerationStatus(status)) {
      const nextPhase = cancelRequested ? "cancel_requested" : (phase || "running");
      setProgressPhase(nextPhase);
      setProgressTarget((prev) => Math.max(prev, Number(nextProgress ?? 0)));
      if (partialData) {
        applyTimetableState(partialData, selectedOptionId);
      }
      return;
    }

    setProgressTarget((prev) =>
      Math.max(prev, Number(status === "completed" ? 100 : nextProgress ?? 0))
    );
    setProgressPhase(cancelRequested && status !== "completed" ? "cancel_requested" : (phase || status || "completed"));

    if (status === "failed" || status === "cancelled" || status === "error") {
      const failureMessage = jobError || result?.error || partialData?.error || "Generation failed";
      const derivedHealthReport =
        healthReport ||
        result?.health_report ||
        partialData?.health_report ||
        null;
      const failureDetails = formatFailureDetails(result || partialData);
      const nextMessage = buildGenerationFailureMessage(failureMessage, derivedHealthReport);
      setError(failureDetails ? `${nextMessage}. ${failureDetails}` : nextMessage);
    }

    if (result || partialData) {
      const normalized = applyTimetableState(result || partialData, selectedOptionId);
      if (normalized?.ok === false && normalized?.error) {
        const derivedHealthReport =
          healthReport ||
          normalized?.health_report ||
          result?.health_report ||
          partialData?.health_report ||
          null;
        const failureDetails = formatFailureDetails(normalized);
        const nextMessage = buildGenerationFailureMessage(normalized.error, derivedHealthReport);
        setError(failureDetails ? `${nextMessage}. ${failureDetails}` : nextMessage);
      }
    }

    if (status === "completed") {
      window.setTimeout(() => setLoading(false), 500);
    } else {
      setLoading(false);
    }
    setSolverDeadlineAt(null);
    setTaskId(null);
    try {
      window.localStorage.removeItem(ACTIVE_GENERATION_TASK_KEY);
    } catch {
      /* ignore */
    }
  }, [
    applyTimetableState,
    buildGenerationFailureMessage,
    generationStatusQuery.data,
    generationStatusQuery.isFetched,
    healthReport,
    formatFailureDetails,
    selectedOptionId,
    taskId,
  ]);

  /* ===================== FIXED SLOTS ===================== */

  const handleSlotChange = (classId, day, hour, comboId) => {
    setFixedSlots(prev => {
      const copy = { ...prev };
      if (!copy[classId]) copy[classId] = {};
      if (!copy[classId][day]) copy[classId][day] = {};
      if (comboId) copy[classId][day][hour] = comboId;
      else delete copy[classId][day][hour];
      return copy;
    });
  };

  const transformFixedSlots = slots => {
    const payload = [];
    Object.entries(slots).forEach(([classId, days]) => {
      Object.entries(days).forEach(([day, hours]) => {
        Object.entries(hours).forEach(([hour, combo]) => {
          if (combo) {
            payload.push({
              class: classId,
              day: Number(day),
              hour: Number(hour),
              combo,
            });
          }
        });
      });
    });
    return payload;
  };



  /* ===================== ACTIONS ===================== */

  const generateTimetable = async (solutionCountOverride = null) => {
    setLoading(true);
    setError("");
    setTimetable(null);
    setTimetableOptions([]);
    setSelectedOptionId("");
    setProgress(0);
    setProgressTarget(0);
    setProgressPhase("queued");
    setSolverDeadlineAt(null);
    setSolverRemainingSec(null);

    try {
      const latestConstraintConfig = constraintConfig;
      const latestHealthReport = await requestHealthCheck(latestConstraintConfig);
      setHealthReport(latestHealthReport);
      if (
        blockGenerateOnHealthErrors &&
        Number(latestHealthReport?.summary?.errors || 0) > 0
      ) {
        setError(
          summarizeHealthIssues(latestHealthReport) ||
            "Generation blocked: health check contains errors. Resolve issues or disable blocking."
        );
        setLoading(false);
        setProgressPhase("error");
        return;
      }
      const solverBudgetSec = Math.max(1, Number(latestConstraintConfig?.solver?.timeLimitSec) || 180);
      const configuredSolutionCount = Math.max(
        1,
        Math.min(5, Number(latestConstraintConfig?.solver?.solutionCount) || 5)
      );
      const solutionCount = Math.max(
        1,
        Math.min(5, Number(solutionCountOverride) || configuredSolutionCount)
      );
      setSolverDeadlineAt(Date.now() + solverBudgetSec * 1000);

      const payload = transformFixedSlots(fixedSlots);
      console.log("Starting generation with payload:", {
        fixedSlots: payload,
        constraintConfig: latestConstraintConfig,
        solutionCount,
      });
      
      const res = await api.post("/generate", {
        fixedSlots: payload,
        constraintConfig: latestConstraintConfig,
        solutionCount,
      });
      const nextTaskId = res.data.taskId;
      setTaskId(nextTaskId);
      setCancelRequestedLocally(false);
      try {
        window.localStorage.setItem(ACTIVE_GENERATION_TASK_KEY, String(nextTaskId));
      } catch {
        /* ignore */
      }
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to start generation.");
      setLoading(false);
      setSolverDeadlineAt(null);
      setSolverRemainingSec(null);
      setProgressPhase("error");
    }
  };



  const runHealthCheck = useCallback(async () => {
    setHealthLoading(true);
    setError("");
    try {
      setHealthReport(await requestHealthCheck(constraintConfig));
    } catch {
      setError("Failed to run health check.");
    } finally {
      setHealthLoading(false);
    }
  }, [constraintConfig, requestHealthCheck]);

  const stopGeneration = async () => {
    if (!taskId) return;
    try {
      await api.post(`/stop-generator/${taskId}`);
      setCancelRequestedLocally(true);
      setProgressPhase("cancel_requested");
    } catch {
      /* ignore */
    }
  };

  const handleSelectOption = (optionId) => {
    const option = timetableOptions.find((item) => String(item.optionId) === String(optionId));
    if (!option) return;

    setSelectedOptionId(option.optionId);
    setTimetable((prev) => ({
      ...(prev || {}),
      ...option,
      selected_option_id: option.optionId,
      class_timetables: option.class_timetables,
      faculty_timetables: option.faculty_timetables,
      faculty_daily_hours: option.faculty_daily_hours ?? prev?.faculty_daily_hours ?? null,
    }));
    setBestScore(option.score ?? null);
    setObjectiveValue(option.objectiveValue ?? null);
    setFacultyDailyHours(option.faculty_daily_hours ?? null);
    if (option.classes) {
      setClasses(option.classes);
    }
    if (option.combos) {
      setCombos(option.combos);
    }
  };

  const handleSave = async () => {
    if (!timetable) {
      alert("No timetable to save.");
      return;
    }

    const name = prompt("Please enter a name for this timetable:");
    if (!name) {
      return;
    }

    try {
      await api.post("/timetables", {
        name,
        timetableData: {
          ...timetable,
          generation_options: timetableOptions,
          selected_option_id: selectedOptionId || timetable?.selected_option_id || null,
        },
      });
      alert("Timetable saved successfully!");
    } catch (err) {
      console.error("Error saving timetable:", err);
      alert(`Failed to save timetable: ${err.response?.data?.error || "Server error"}`);
    }
  };
    
  /* ===================== HELPERS ===================== */

  const getClassName = id => {
    const cls = classById.get(String(id));
    if (!cls) return id;
    const name = cls.name || cls.id || id;
    const semPart = cls.sem != null ? `Sem ${cls.sem}` : null;
    const sectionPart = cls.section ? `${cls.section}` : null;
    const meta = [semPart, sectionPart].filter(Boolean).join(", ");
    return meta ? `${name} (${meta})` : name;
  };

  const escapeHtml = (value) => {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };
        
          const getFacultyName = id => facultyById.get(String(id))?.name || id;

  const getSubjectDisplayName = (subjectId) => {
    const subject = subjectById.get(String(subjectId));
    return subject?.name || `Subject ${String(subjectId).slice(-4)}`;
  };

  const getSlotDisplay = (slot) => {
    if (!slot || slot === -1 || slot === "BREAK") {
      return { subjectName: "-", facultyNames: [], combinedWith: [] };
    }

    const combo = comboById.get(String(slot));
    if (!combo) {
      return { subjectName: "?", facultyNames: [], combinedWith: [] };
    }

    const subject = subjectById.get(String(combo.subject_id));
    const subjectName = getSubjectDisplayName(combo.subject_id);

    let facultyNames = [];
    if (combo.faculty_ids && Array.isArray(combo.faculty_ids)) {
      facultyNames = combo.faculty_ids.map((fid) => {
        const fac = facultyById.get(String(fid));
        return fac ? fac.name : "N/A";
      });
    } else if (combo.faculty_id) {
      const fac = facultyById.get(String(combo.faculty_id));
      facultyNames = [fac ? fac.name : "N/A"];
    }
    if (facultyNames.length === 0 && String(subject?.type || "").toLowerCase() === "no_teacher") {
      facultyNames = ["No Teacher"];
    }

    const combinedWith = Array.isArray(combo.class_ids)
      ? combo.class_ids.map(String)
      : [];

    return { subjectName, facultyNames, combinedWith };
  };

  const buildPdfHtml = ({ entries, filtered }) => {
    const now = new Date();
    const filtersText = [
      selectedClass ? `Class: ${getClassName(selectedClass)}` : null,
      selectedFaculty ? `Faculty: ${getFacultyName(selectedFaculty)}` : null,
      selectedSubject
        ? `Subject: ${subjectById.get(String(selectedSubject))?.name || selectedSubject}`
        : null,
    ]
      .filter(Boolean)
      .join(" | ");

    const sections = entries
      .map(([classId, slots]) => {
        const rows = slots
          .map((row, dayIndex) => {
            const cells = row
              .map((slot) => {
                const matches = filtered ? isCellMatching(slot) : true;
                const { subjectName, facultyNames, combinedWith } = getSlotDisplay(slot);
                const facultyLine = facultyNames.length
                  ? `<div class="faculty">${escapeHtml(facultyNames.join(", "))}</div>`
                  : "";
                const combinedLine = combinedWith.length > 1
                  ? `<div class="faculty">Combined: ${escapeHtml(combinedWith.map((id) => getClassName(id)).join(" + "))}</div>`
                  : "";
                return `<td class="${matches ? "" : "dim"}"><div class="subject">${escapeHtml(subjectName)}</div>${facultyLine}${combinedLine}</td>`;
              })
              .join("");
            return `<tr><td class="day">Day ${dayIndex + 1}</td>${cells}</tr>`;
          })
          .join("");

        return `
          <div class="class-block">
            <h3>${escapeHtml(getClassName(classId))}</h3>
            <table>
              <thead>
                <tr>
                  <th>Day / Period</th>
                  ${Array.from({ length: HOURS_PER_DAY })
                    .map((_, p) => `<th>P${p + 1}</th>`)
                    .join("")}
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        `;
      })
      .join("");

    return `
      <div class="pdf-root">
        <h1>${filtered ? "Filtered Timetable" : "Generated Timetable"}</h1>
        <div class="meta">Generated on: ${escapeHtml(now.toLocaleString())}</div>
        ${filtered && filtersText ? `<div class="meta">Filters: ${escapeHtml(filtersText)}</div>` : ""}
        ${sections}
      </div>
    `;
  };

  const downloadPdfFromHtml = (html, title) => {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) {
      throw new Error("Unable to open print window.");
    }

    popup.document.open();
    popup.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>${escapeHtml(title)}</title>
          <style>
            @page { size: A4 portrait; margin: 10mm; }
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; color: #111; }
            .pdf-root h1 { margin: 0 0 10px 0; }
            .pdf-root .meta { margin: 0 0 8px 0; font-size: 13px; color: #444; }
            .pdf-root .class-block { margin-top: 18px; page-break-inside: avoid; }
            .pdf-root .class-block h3 { margin: 0 0 8px 0; font-size: 16px; }
            .pdf-root table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            .pdf-root th, .pdf-root td { border: 1px solid #d0d0d0; padding: 6px; font-size: 10px; vertical-align: top; word-wrap: break-word; }
            .pdf-root th { background: #f2f2f2; }
            .pdf-root .day { font-weight: 700; width: 95px; }
            .pdf-root .subject { font-weight: 700; }
            .pdf-root .faculty { margin-top: 3px; color: #333; }
            .pdf-root .dim { opacity: 0.35; }
          </style>
        </head>
        <body>${html}</body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const downloadGeneratedExcel = async () => {
    if (!timetable) {
      alert("No timetable available to download.");
      return;
    }
    try {
      const response = await api.post("/timetable/export/excel", {
        timetable,
        mode: "class",
      }, { responseType: "blob" });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${(timetable.name || "timetable").replace(/\s+/g, "_")}_full.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Excel export failed:", err);
      setError("Failed to download generated timetable Excel.");
    }
  };

  const downloadFilteredExcel = async () => {
    if (!timetable) {
      alert("No timetable available to download.");
      return;
    }
    try {
      const filters = {
        classId: selectedClass || undefined,
        facultyId: selectedFaculty || undefined,
        subjectId: selectedSubject || undefined,
      };

      const response = await api.post("/timetable/export/excel", {
        timetable,
        mode: "class",
        filters,
      }, { responseType: "blob" });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${(timetable.name || "timetable").replace(/\s+/g, "_")}_filtered.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Excel export failed:", err);
      setError("Failed to download filtered timetable Excel.");
    }
  };

  const downloadGeneratedPdf = () => {
    if (!timetable || !timetable.class_timetables) {
      alert("No timetable available to download.");
      return;
    }

    const entries = Object.entries(timetable.class_timetables);
    if (!entries.length) {
      alert("No timetable data available to download.");
      return;
    }

    try {
      const html = buildPdfHtml({ entries, filtered: false });
      downloadPdfFromHtml(html, "Generated Timetable PDF");
    } catch {
      setError("Failed to download generated timetable PDF.");
    }
  };

  const downloadFilteredPdf = () => {
    if (!timetable || !timetable.class_timetables) {
      alert("No timetable available to download.");
      return;
    }

    const entries = filteredTimetable();
    if (!entries.length) {
      alert("No filtered timetable data available to download.");
      return;
    }

    try {
      const html = buildPdfHtml({ entries, filtered: true });
      downloadPdfFromHtml(html, "Filtered Timetable PDF");
    } catch {
      setError("Failed to download filtered timetable PDF.");
    }
  };


  const renderEmptyTable = (classId) => {
    const classOptions = fixedClassComboOptionsByClass.get(String(classId)) || [];
    return (
      <div key={classId} className="tt-class-block">
        <h3>
          Class: {getClassName(classId)}
        </h3>
        <div className="table-responsive">
          <table className="styled-table">
            <thead>
              <tr>
                <th>Day / Period</th>
                {Array.from({ length: HOURS_PER_DAY }).map((_, p) => (
                  <th key={p}>P{p + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: DAYS_PER_WEEK }).map((_, d) => (
                <tr key={d}>
                  <td>Day {d + 1}</td>
                  {Array.from({ length: HOURS_PER_DAY }).map((_, h) => {
                    const isBreak = (constraintConfig?.schedule?.breakHours || []).map(Number).includes(h);
                    if (isBreak) {
                      return (
                        <td key={h} className="tt-break-cell">
                          <span className="tt-break-label">BREAK</span>
                        </td>
                      );
                    }
                    const selected =
                      fixedSlots[classId]?.[d]?.[h] || "";
                    return (
                      <td key={h}>
                        <select
                          value={selected}
                          onChange={(e) =>
                            handleSlotChange(classId, d, h, e.target.value)
                          }
                        >
                          <option value="">
                            --Select faculty-subject--
                          </option>
                          {classOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
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

  const filteredTimetable = () => {
    if (!timetable || !timetable.class_timetables) {
      return [];
    }

    let allClassTimetables = Object.entries(timetable.class_timetables);

    if (selectedClass) {
      allClassTimetables = allClassTimetables.filter(
        ([classId]) => classId === selectedClass
      );
    }

    return allClassTimetables;
  };

  const filteredFacultyTimetable = () => {
    if (!timetable || !timetable.faculty_timetables) {
      return [];
    }

    let allFacultyTimetables = Object.entries(timetable.faculty_timetables);

    if (selectedFaculty) {
      allFacultyTimetables = allFacultyTimetables.filter(
        ([facultyId]) => String(facultyId) === String(selectedFaculty)
      );
    }

    return allFacultyTimetables;
  };

  const isCellMatching = (slotComboId) => {
    const hasFilter = selectedFaculty || selectedSubject;
    if (!hasFilter) {
      return true; // No filter, all match
    }

    if (!slotComboId || slotComboId === -1 || slotComboId === "BREAK") {
      return false;
    }

    const combo = comboById.get(String(slotComboId));
    if (!combo) {
      return false;
    }

    const facultyMatch = () => {
        if (!selectedFaculty) return true;
        if (combo.faculty_ids) {
            return combo.faculty_ids.some((fid) => String(fid) === String(selectedFaculty));
        } else if (combo.faculty_id) {
            return String(combo.faculty_id) === String(selectedFaculty);
        }
        return false;
    }

    const subjectMatch = () => {
        if (!selectedSubject) return true;
        return String(combo.subject_id) === selectedSubject;
    }

    return facultyMatch() && subjectMatch();
  };

  const isFacultyCellMatching = (slotComboId) => {
    if (!slotComboId || slotComboId === -1 || slotComboId === "BREAK") {
      return false;
    }

    const combo = comboById.get(String(slotComboId));
    if (!combo) {
      return false;
    }

    const subjectMatches = !selectedSubject || String(combo.subject_id) === String(selectedSubject);
    const classIds = Array.isArray(combo.class_ids) ? combo.class_ids.map(String) : [];
    const classMatches = !selectedClass || classIds.length === 0 || classIds.includes(String(selectedClass));

    return subjectMatches && classMatches;
  };

  const getFacultySlotDisplay = (slot) => {
    if (!slot || slot === -1 || slot === "BREAK") {
      return { subjectName: "-", classNames: [] };
    }

    const combo = comboById.get(String(slot));
    if (!combo) {
      return { subjectName: "?", classNames: [] };
    }

    const subjectName = getSubjectDisplayName(combo.subject_id);
    const classNames = Array.isArray(combo.class_ids)
      ? combo.class_ids.map((id) => getClassName(id))
      : [];

    return { subjectName, classNames };
  };

  const calculateAssignedHours = (slots) => {
    const assignedHours = {};
    if (!slots) return assignedHours;

    slots.forEach(dayRow => {
      dayRow.forEach(slot => {
        if (slot && slot !== -1 && slot !== "BREAK") {
          const combo = comboById.get(String(slot));
          if (combo) {
            const subjectId = combo.subject_id;
            if (!assignedHours[subjectId]) {
              assignedHours[subjectId] = 0;
            }
            assignedHours[subjectId]++;
          }
        }
      });
    });
    return assignedHours;
  };

  const buildDisplayRequiredHours = (currentClass, assignmentRequiredHours) => {
    const classRequiredHours =
      currentClass?.subject_hours && typeof currentClass.subject_hours === "object"
        ? currentClass.subject_hours
        : {};

    const filteredAssignmentHours = Object.entries(assignmentRequiredHours || {}).reduce(
      (acc, [subjectId, hours]) => {
        // If we have virtual electives, we should be careful about double counting
        // component subjects. For now, we allow them unless we have a better way
        // to detect components without the isElective flag.
        acc[subjectId] = hours;
        return acc;
      },
      {}
    );

    // Class-level subject_hours from generator data is authoritative because
    // electives are rewritten into virtual subjects there.
    return {
      ...filteredAssignmentHours,
      ...classRequiredHours,
    };
  };

  const resetFilters = () => {
    setSelectedClass("");
    setSelectedFaculty("");
    setSelectedSubject("");
  };

  const clearFixedSlots = () => {
    setFixedSlots({});
  };

  const getProgressMessage = () => {
    switch (progressPhase) {
      case "queued":
        return "Preparing generation...";
      case "cancel_requested":
        return "Cancel requested. Waiting for solver to stop...";
      case "reconnecting":
        return "Reconnecting... generation is still running.";
      case "start":
      case "running":
        return "Generating timetable options...";
      case "solver_done":
        return "Solver finished this pass. Preparing options...";
      case "candidate_ready":
        return "A valid timetable is ready. Searching for more options...";
      case "completed":
        return "Generation complete.";
      case "error":
        return "Generation failed.";
      default:
        return loading ? "Generating..." : "";
    }
  };

  const currentGenerationStatus = taskId
    ? (generationStatusQuery.data?.status || "pending")
    : null;
  const currentGenerationPhase =
    taskId && (generationStatusQuery.data?.cancelRequested || cancelRequestedLocally) && currentGenerationStatus !== "completed"
      ? "cancel_requested"
      : (generationStatusQuery.data?.phase || progressPhase || "idle");
  const canCancelGeneration =
    Boolean(taskId) &&
    !generationStatusQuery.data?.cancelRequested &&
    !cancelRequestedLocally &&
    !isTerminalGenerationStatus(currentGenerationStatus);
  const showGenerationCard =
    Boolean(taskId) ||
    (loading && progressPhase !== "idle") ||
    progressPhase === "reconnecting";
  const visibleProgress = Math.max(0, Math.min(100, Number(progress || 0)));
  const visibleRemainingSec =
    solverRemainingSec != null
      ? solverRemainingSec
      : generationStatusQuery.data?.remainingSec != null
        ? Number(generationStatusQuery.data.remainingSec)
        : null;

  const formatGenerationStatusLabel = (value) =>
    String(value || "unknown")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (match) => match.toUpperCase());

  const formatCountdown = (totalSec) => {
    const safe = Math.max(0, Number(totalSec) || 0);
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  /* ===================== RENDER ===================== */

  return (
    <div className="manage-container">
      <h2>Timetable Generator</h2>

      {showGenerationCard ? (
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
      ) : null}

      <div className="actions-bar">
        <button className="secondary-btn" onClick={runHealthCheck} disabled={loading || healthLoading}>
          {healthLoading ? "Checking..." : "Run Health Check"}
        </button>
        <button
          className="secondary-btn"
          onClick={() => generateTimetable(1)}
          disabled={loading || isGenerateBlockedByHealth}
          title={
            isGenerateBlockedByHealth
              ? "Blocked by health check errors"
              : "Generate a single timetable"
          }
        >
          Generate
        </button>
        {/* <button
          className="primary-btn"
          onClick={() => generateTimetable()}
          disabled={loading || isGenerateBlockedByHealth}
          title={
            isGenerateBlockedByHealth
              ? "Blocked by health check errors"
              : "Generate timetable"
          }
        >
          Generate Top {constraintConfig?.solver?.solutionCount ?? 5} // not working well currently, needs backend support to prioritize multiple solutions
        </button> */}
        {/* <button className="danger-btn" onClick={stopGeneration} disabled={!loading}>
          Stop
        </button> */}
        {/* <button className="secondary-btn" onClick={fetchLatest} disabled={loading}>
          Fetch Latest
        </button> */}
        {/* <button className="secondary-btn" onClick={regenerateTimetable} disabled={loading}>
          Regenerate
        </button> */}
        <button className="secondary-btn" onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? "Hide Filters" : "Show Filters"}
        </button>
        <button className="secondary-btn" onClick={() => setShowFixedClasses((v) => !v)}>
          {showFixedClasses ? "Hide Fixed Classes" : "Show Fixed Classes"}
        </button>
        {/* <button className="secondary-btn" onClick={deleteAllTimetables} disabled={loading}>
          Delete All
        </button> */}
        <button className="primary-btn" onClick={handleSave} disabled={loading || !timetable}>
          Save Selected Timetable
        </button>
        <button className="secondary-btn" onClick={downloadGeneratedPdf} disabled={loading || !timetable}>
          Download Generated PDF
        </button>
        <button className="secondary-btn" onClick={downloadFilteredPdf} disabled={loading || !timetable}>
          Download Filtered PDF
        </button>
        <button className="secondary-btn" onClick={downloadGeneratedExcel} disabled={loading || !timetable}>
          Download Generated Excel
        </button>
        <button className="secondary-btn" onClick={downloadFilteredExcel} disabled={loading || !timetable}>
          Download Filtered Excel
        </button>
      </div>
      <div className="tt-options-row">
        <label className="tt-inline-toggle">
          <input
            type="checkbox"
            checked={blockGenerateOnHealthErrors}
            onChange={(e) => setBlockGenerateOnHealthErrors(e.target.checked)}
          />
          <span>Block generate on health errors</span>
        </label>
        <div className="filters-container">
          <button
            type="button"
            className={displayMode === "class" ? "primary-btn" : "secondary-btn"}
            onClick={() => setDisplayMode("class")}
            disabled={!timetable?.class_timetables}
          >
            Show Class Timetables
          </button>
          <button
            type="button"
            className={displayMode === "faculty" ? "primary-btn" : "secondary-btn"}
            onClick={() => setDisplayMode("faculty")}
            disabled={!hasRenderableTable(timetable?.faculty_timetables)}
            title={
              hasRenderableTable(timetable?.faculty_timetables)
                ? "Show faculty timetables"
                : "No faculty timetable data returned yet"
            }
          >
            Show Faculty Timetables
          </button>
        </div>
      </div>

      {timetableOptions.length > 0 ? (
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
      ) : null}

      {showFilters && (
        <div className="filters-container">
          <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
            <option value="">All Classes</option>
            {classes.map((cls) => (
              <option key={cls._id} value={cls._id}>
                {getClassName(cls._id)}
              </option>
            ))}
          </select>

          <select value={selectedFaculty} onChange={(e) => setSelectedFaculty(e.target.value)}>
            <option value="">All Faculties</option>
            {faculties.map((fac) => (
              <option key={fac._id} value={fac._id}>
                {getFacultyName(fac._id)}
              </option>
            ))}
          </select>

          <select value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)}>
            <option value="">All Subjects</option>
            {subjects.map((sub) => (
              <option key={sub._id} value={sub._id}>
                {sub.name}
              </option>
            ))}
          </select>

          <button onClick={resetFilters} className="secondary-btn">
            Reset
          </button>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="tt-section-card">
        <h3>Active Constraint Policy</h3>
        <p className="tt-subtext">
          Configure solver rules on the dedicated settings page.
        </p>
        <div className="filters-container">
          <span>Days: {constraintConfig?.schedule?.daysPerWeek ?? 6}</span>
          <span>Hours: {constraintConfig?.schedule?.hoursPerDay ?? 8}</span>
          <span>Solver Time: {constraintConfig?.solver?.timeLimitSec ?? 180}s</span>
          <span>Options: {constraintConfig?.solver?.solutionCount ?? 5}</span>
          <Link className="secondary-btn tt-soft-accent-btn" to="/timetable/settings">
            Open Timetable Settings
          </Link>
        </div>
      </div>

      {healthReport ? (
        <div className="tt-section-card tt-audit-card">
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
      ) : null}

      {showFixedClasses ? (
      <div className="tt-section-card">
        <h3>Fixed Classes (Empty Timetable)</h3>
        <p className="tt-subtext">
          Assign slots here to lock them before you generate.
        </p>
        <button className="secondary-btn tt-soft-accent-btn" onClick={clearFixedSlots} disabled={loading}>
          Clear Fixed Classes
        </button>
        <div className="filters-container tt-top-gap">
          <label>
            Fixed Class
            <select
              value={fixedClassId}
              onChange={(e) => setFixedClassId(e.target.value)}
              className="tt-fixed-class-select"
            >
              {classes.map((cls) => (
                <option key={cls._id} value={cls._id}>
                  {getClassName(cls._id)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="tt-table-gap">
          {fixedClassId
            ? classes
                .filter((cls) => String(cls._id) === String(fixedClassId))
                .map((cls) => renderEmptyTable(cls._id))
            : <p>Select a class to assign fixed slots.</p>}
        </div>
      </div>
      ) : null}

      {timetable && displayMode === "class" && timetable.class_timetables && (
        <div className="tt-section-card">
          <div className="filters-container">
            <span>Active Option: {selectedOptionId ? (timetableOptions.find((item) => String(item.optionId) === String(selectedOptionId))?.label || "Selected") : "Best available"}</span>
            <span>Gap Score: {bestScore ?? "N/A"}</span>
            <span>Objective: {objectiveValue ?? "N/A"}</span>
            <span>Teacher Daily Hours: {facultyDailyHours ? "Available" : "Not reported"}</span>
          </div>
          {filteredTimetable().map(([classId, slots]) => {
            const assignedHours = calculateAssignedHours(slots);
            const currentClass = classById.get(classId);

            return (
              <div key={classId} className="tt-class-block">
                <h3>{getClassName(classId)}</h3>
                <div className="table-responsive">
                  <table className="styled-table">
                    <thead>
                      <tr>
                        <th>Day / Period</th>
                        {Array.from({ length: HOURS_PER_DAY }).map((_, p) => (
                          <th key={p}>P{p + 1}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {slots.map((row, d) => (
                        <tr key={d}>
                          <td>Day {d + 1}</td>
                          {row.map((slot, h) => {
                            const cellMatches = isCellMatching(slot);
                            const cellClassName = cellMatches ? "" : "tt-cell-dim";

                            if (!slot || slot === -1 || slot === "BREAK") {
                              return <td key={h} className={cellClassName}>-</td>;
                            }

                            const combo = comboById.get(String(slot));
                            if (!combo) {
                              return <td key={h} className={cellClassName}>?</td>;
                            }

                            const subject = subjectById.get(String(combo.subject_id));
                            const subjectName = getSubjectDisplayName(combo.subject_id);

                            let facultyNames = [];
                            if (combo.faculty_ids) {
                                facultyNames = (combo.faculty_ids || []).map(tid => {
                                    const faculty = facultyById.get(String(tid));
                                    return faculty ? faculty.name : "N/A";
                                });
                            } else if (combo.faculty_id) {
                                const faculty = facultyById.get(String(combo.faculty_id));
                                if (faculty) {
                                    facultyNames.push(faculty.name);
                                } else {
                                    facultyNames.push("N/A");
                                }
                            }
                            if (facultyNames.length === 0 && String(subject?.type || "").toLowerCase() === "no_teacher") {
                                facultyNames.push("No Teacher");
                            }

                            const combinedClassIds = Array.isArray(combo.class_ids)
                              ? combo.class_ids.map(String)
                              : [];
                            const combinedLabel = combinedClassIds.length > 1
                              ? combinedClassIds.map((id) => getClassName(id)).join(" + ")
                              : "";

                            return (
                              <td key={h} className={cellClassName}>
                                <div>
                                  <b>{subjectName}</b>
                                </div>
                                {facultyNames.map((name, i) => <div key={i}>{name}</div>)}
                                {combinedLabel ? <div>Combined: {combinedLabel}</div> : null}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="tt-hours-report">
                    <h4>Subject Hours Report</h4>
                    {(() => {
                        if (!currentClass) return null;
                        const classIdKey = String(classId);
                        const requiredFromAssignments = requiredHoursByClassSubject.get(classIdKey) || {};
                        const requiredHours = buildDisplayRequiredHours(
                          currentClass,
                          requiredFromAssignments
                        );

                        const allSubjectIds = new Set([
                          ...Object.keys(requiredHours),
                          ...Object.keys(assignedHours),
                        ]);

                        const mergedRows = new Map();
                        Array.from(allSubjectIds).forEach((subjectId) => {
                          const assigned = Number(assignedHours[subjectId] || 0);
                          const requiredValue = requiredHours[subjectId];
                          const required =
                            requiredValue === undefined || requiredValue === null
                              ? "N/A"
                              : Number(requiredValue);

                          if (assigned === 0 && required === 0) return;
                          if (assigned === 0 && required === "N/A") return;

                          const name = getSubjectDisplayName(subjectId);
                          const existing = mergedRows.get(name);
                          if (!existing) {
                            mergedRows.set(name, { assigned, required });
                            return;
                          }

                          existing.assigned += assigned;
                          if (required !== "N/A") {
                            existing.required =
                              existing.required === "N/A"
                                ? required
                                : Number(existing.required) + required;
                          }
                        });

                        const rows = Array.from(mergedRows.entries()).map(([name, values]) => {
                          return (
                            <div key={name} className="tt-hours-row">
                              <span>{name}: {values.assigned} / {values.required}</span>
                            </div>
                          );
                        });

                        if (!rows.length) {
                          return <div className="tt-hours-row">No subject hours data available.</div>;
                        }

                        return (
                          <>
                            {rows}
                          </>
                        );
                    })()}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {timetable && displayMode === "faculty" && hasRenderableTable(timetable.faculty_timetables) && (
        <div className="tt-section-card">
          <div className="filters-container">
            <span>Active Option: {selectedOptionId ? (timetableOptions.find((item) => String(item.optionId) === String(selectedOptionId))?.label || "Selected") : "Best available"}</span>
            <span>Gap Score: {bestScore ?? "N/A"}</span>
            <span>Objective: {objectiveValue ?? "N/A"}</span>
            <span>Teacher Daily Hours: {facultyDailyHours ? "Available" : "Not reported"}</span>
          </div>
          {filteredFacultyTimetable().map(([facultyId, slots]) => (
            <div key={facultyId} className="tt-class-block">
              <h3>{getFacultyName(facultyId)}</h3>
              <div className="table-responsive">
                <table className="styled-table">
                  <thead>
                    <tr>
                      <th>Day / Period</th>
                      {Array.from({ length: HOURS_PER_DAY }).map((_, p) => (
                        <th key={p}>P{p + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map((row, d) => (
                      <tr key={d}>
                        <td>Day {d + 1}</td>
                        {row.map((slot, h) => {
                          const cellMatches = isFacultyCellMatching(slot);
                          const hasFilter = selectedClass || selectedSubject;
                          const cellClassName = !hasFilter || cellMatches ? "" : "tt-cell-dim";

                          if (!slot || slot === -1 || slot === "BREAK") {
                            return <td key={h} className={cellClassName}>-</td>;
                          }

                          const { subjectName, classNames } = getFacultySlotDisplay(slot);

                          return (
                            <td key={h} className={cellClassName}>
                              <div>
                                <b>{subjectName}</b>
                              </div>
                              {classNames.map((name, i) => <div key={i}>{name}</div>)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {!filteredFacultyTimetable().length ? (
            <p>No faculty timetables match the selected filters.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default Timetable;
