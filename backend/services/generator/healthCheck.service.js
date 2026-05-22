function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function requiredHoursFor(classObj, subjectObj) {
  const subjectId = String(subjectObj?._id || subjectObj?.id || "");
  const classHours = classObj?.subject_hours || {};
  if (subjectId && classHours[subjectId] != null) {
    return Math.max(0, toInt(classHours[subjectId], 0));
  }
  return Math.max(0, toInt(subjectObj?.no_of_hours_per_week, 0));
}

function getConstraintSchedule(constraintConfig = {}) {
  const schedule = constraintConfig?.schedule || {};
  return {
    daysPerWeek: Math.max(1, toInt(schedule.daysPerWeek, 6)),
    hoursPerDay: Math.max(1, toInt(schedule.hoursPerDay, 8)),
    breakHours: Array.from(
      new Set(
        (Array.isArray(schedule.breakHours) ? schedule.breakHours : [])
          .map((v) => toInt(v, -1))
          .filter((h) => h >= 0)
      )
    ),
  };
}

function getComboFacultyIds(combo) {
  if (Array.isArray(combo?.faculty_ids) && combo.faculty_ids.length > 0) {
    return combo.faculty_ids.map(String);
  }
  if (combo?.faculty_id) return [String(combo.faculty_id)];
  return [];
}

function normalizeSlotList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = new Set();
  for (const slot of list) {
    const day = toInt(slot?.day, -1);
    const hour = toInt(slot?.hour, -1);
    if (day < 0 || hour < 0) continue;
    out.add(`${day}|${hour}`);
  }
  return out;
}

function normalizeTeacherSlotMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Map();
  const out = new Map();
  for (const [teacherId, slots] of Object.entries(raw)) {
    const key = String(teacherId || "");
    if (!key) continue;
    out.set(key, normalizeSlotList(slots));
  }
  return out;
}

function normalizeTeacherPreferencesMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Map();
  const out = new Map();
  for (const [teacherId, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    out.set(String(teacherId), {
      avoidFirstPeriod: Boolean(value.avoidFirstPeriod),
      avoidLastPeriod: Boolean(value.avoidLastPeriod),
      maxConsecutive:
        Number.isInteger(Number(value.maxConsecutive)) && Number(value.maxConsecutive) > 0
          ? Number(value.maxConsecutive)
          : null,
      preferredDays: Array.from(
        new Set(
          (Array.isArray(value.preferredDays) ? value.preferredDays : [])
            .map((day) => toInt(day, -1))
            .filter((day) => day >= 0)
        )
      ).sort((a, b) => a - b),
    });
  }
  return out;
}

export function buildConstraintHealthReport({
  faculties = [],
  subjects = [],
  classes = [],
  combos = [],
  fixedSlots = [],
  constraintConfig = {},
}) {
  const warnings = [];
  const schedule = getConstraintSchedule(constraintConfig);
  const breakSet = new Set(
    schedule.breakHours.filter((h) => h >= 0 && h < schedule.hoursPerDay)
  );
  const usableSlotsPerDay = Math.max(0, schedule.hoursPerDay - breakSet.size);

  const subjectById = new Map(subjects.map((s) => [String(s._id), s]));
  const comboById = new Map(combos.map((c) => [String(c._id), c]));

  for (const combo of combos) {
    const subjectId = String(combo?.subject_id || "");
    const subject = subjectById.get(subjectId);
    if (!subject || String(subject.type || "").toLowerCase() !== "no_teacher") continue;
    const facultyIds = getComboFacultyIds(combo);
    if (facultyIds.length > 0) {
      warnings.push({
        severity: "warning",
        type: "no_teacher_has_teacher",
        message: `No-teacher subject "${subject.name || subjectId}" has teacher assignment(s): ${facultyIds.join(", ")}.`,
      });
    }
  }

  const potentialTeacherLoad = new Map(faculties.map((f) => [String(f._id), 0]));
  const estimatedTeacherLoad = new Map(faculties.map((f) => [String(f._id), 0]));
  const forcedTeacherLoad = new Map(faculties.map((f) => [String(f._id), 0]));
  const teacherAvailabilityCfg = constraintConfig?.teacherAvailability || {};
  const teacherPreferencesCfg = constraintConfig?.teacherPreferences || {};
  const weeklyBalanceCfg = constraintConfig?.teacherWeeklyLoadBalance || {};
  const classDailyMinCfg = constraintConfig?.classDailyMinimumLoad || {};
  const weeklySubjectHoursCfg = constraintConfig?.weeklySubjectHours || {};

  let totalClassRequired = 0;
  let totalClassCapacity = 0;

  for (const cls of classes) {
    const classId = String(cls._id);
    const assignedComboIds = new Set(
      Array.isArray(cls.assigned_teacher_subject_combos)
        ? cls.assigned_teacher_subject_combos.map((id) => String(id)).filter(Boolean)
        : []
    );
    if (assignedComboIds.size === 0) {
      warnings.push({
        severity: "warning",
        type: "class_has_no_teacher_subject_combos",
        message: `Class "${cls.name || classId}" has no teacher-subject combos assigned. It will be skipped during generation.`,
      });
      continue;
    }

    const days = Math.max(1, toInt(cls.days_per_week, schedule.daysPerWeek));
    const classCapacity = days * usableSlotsPerDay;
    totalClassCapacity += classCapacity;

    const allowedComboIds = new Set(
      (cls.assigned_teacher_subject_combos || []).map((id) => String(id))
    );
    for (const combo of combos) {
      const classIds = (combo.class_ids || []).map(String);
      if (classIds.includes(classId)) {
        allowedComboIds.add(String(combo._id));
      }
    }

    const eligibleBySubject = new Map();
    const comboFacultyGroupsBySubject = new Map();
    for (const comboId of allowedComboIds) {
      const combo = comboById.get(comboId);
      if (!combo) continue;
      const classIds = (combo.class_ids || []).map(String);
      if (classIds.length > 0 && !classIds.includes(classId)) continue;
      const subjectId = String(combo.subject_id);
      if (!eligibleBySubject.has(subjectId)) eligibleBySubject.set(subjectId, new Set());
      const facultyIds = Array.from(new Set(getComboFacultyIds(combo)));
      if (!comboFacultyGroupsBySubject.has(subjectId)) comboFacultyGroupsBySubject.set(subjectId, []);
      if (facultyIds.length > 0) comboFacultyGroupsBySubject.get(subjectId).push(facultyIds);
      for (const fid of facultyIds) {
        eligibleBySubject.get(subjectId).add(fid);
      }
    }

    const classSubjectHours =
      cls?.subject_hours && typeof cls.subject_hours === "object" && !Array.isArray(cls.subject_hours)
        ? cls.subject_hours
        : null;
    const classSubjectIds = classSubjectHours
      ? Object.keys(classSubjectHours).filter((sid) => toInt(classSubjectHours[sid], 0) > 0)
      : [];

    let classRequired = 0;
    const subjectScope =
      classSubjectIds.length > 0
        ? classSubjectIds.map((sid) => subjectById.get(String(sid)) || { _id: String(sid), name: String(sid) })
        : subjects;

    for (const subject of subjectScope) {
      const subjectId = String(subject._id);
      const req =
        classSubjectIds.length > 0
          ? Math.max(0, toInt(classSubjectHours?.[subjectId], 0))
          : requiredHoursFor(cls, subject);
      if (req <= 0) continue;
      classRequired += req;

      const eligibleSet = eligibleBySubject.get(subjectId) || new Set();
      const subjectType = String(subject?.type || "").toLowerCase();
      const isNoTeacher = subjectType === "no_teacher";

      if (eligibleSet.size === 0) {
        const hasCombos = eligibleBySubject.has(subjectId);
        if (!isNoTeacher || !hasCombos) {
          warnings.push({
            severity: "error",
            type: "missing_coverage",
            message: `No eligible teacher-subject combo for class "${cls.name || classId}" subject "${subject.name || subjectId}".`,
          });
          continue;
        }
      }

      // Upper bound (legacy metric): a teacher might take all required hours if selected.
      for (const fid of eligibleSet) {
        potentialTeacherLoad.set(fid, (potentialTeacherLoad.get(fid) || 0) + req);
      }

      const comboGroups = comboFacultyGroupsBySubject.get(subjectId) || [];
      if (comboGroups.length > 0) {
        // Estimate load by equally distributing a subject's hours across candidate combos,
        // and across teachers participating in each combo.
        const perComboWeight = req / comboGroups.length;
        const presenceCount = new Map();
        for (const group of comboGroups) {
          const uniqueGroup = Array.from(new Set(group));
          const perTeacherShare = uniqueGroup.length > 0 ? perComboWeight / uniqueGroup.length : 0;
          for (const fid of uniqueGroup) {
            estimatedTeacherLoad.set(
              fid,
              (estimatedTeacherLoad.get(fid) || 0) + perTeacherShare
            );
            presenceCount.set(fid, (presenceCount.get(fid) || 0) + 1);
          }
        }
        // If a teacher appears in every feasible combo, their load for this subject is forced.
        for (const [fid, count] of presenceCount.entries()) {
          if (count === comboGroups.length) {
            forcedTeacherLoad.set(fid, (forcedTeacherLoad.get(fid) || 0) + req);
          }
        }
      } else if (eligibleSet.size > 0) {
        const perTeacherShare = req / eligibleSet.size;
        for (const fid of eligibleSet) {
          estimatedTeacherLoad.set(
            fid,
            (estimatedTeacherLoad.get(fid) || 0) + perTeacherShare
          );
        }
      }

      if (comboGroups.length === 0 && eligibleSet.size === 1) {
        const [onlyFid] = Array.from(eligibleSet);
        forcedTeacherLoad.set(onlyFid, (forcedTeacherLoad.get(onlyFid) || 0) + req);
      }
    }

    totalClassRequired += classRequired;
    if (classRequired > classCapacity) {
      warnings.push({
        severity: "error",
        type: "class_over_capacity",
        message: `Class "${cls.name || classId}" requires ${classRequired} hours, capacity is ${classCapacity}.`,
      });
    }
  }

  const teacherWeeklyCapacity = schedule.daysPerWeek * usableSlotsPerDay;
  const globalUnavailable = normalizeSlotList(teacherAvailabilityCfg.globallyUnavailableSlots);
  const unavailableByTeacher = normalizeTeacherSlotMap(
    teacherAvailabilityCfg.unavailableSlotsByTeacher
  );
  const teacherAvailabilityEnabled = Boolean(teacherAvailabilityCfg.enabled);
  const teacherAvailabilityHard = teacherAvailabilityCfg.hard !== false;
  const teacherPreferences = normalizeTeacherPreferencesMap(teacherPreferencesCfg);

  for (const faculty of faculties) {
    const fid = String(faculty._id);
    const forced = forcedTeacherLoad.get(fid) || 0;
    const estimated = estimatedTeacherLoad.get(fid) || 0;
    const potential = potentialTeacherLoad.get(fid) || 0;
    const teacherUnavailable = unavailableByTeacher.get(fid) || new Set();
    let unavailableCount = 0;
    for (const dayHour of globalUnavailable) {
      const [, hourText] = String(dayHour).split("|");
      const hour = toInt(hourText, -1);
      if (hour >= 0 && hour < schedule.hoursPerDay) unavailableCount += 1;
    }
    for (const dayHour of teacherUnavailable) {
      const [, hourText] = String(dayHour).split("|");
      const hour = toInt(hourText, -1);
      if (hour >= 0 && hour < schedule.hoursPerDay && !globalUnavailable.has(dayHour)) {
        unavailableCount += 1;
      }
    }
    const teacherEffectiveCapacity = Math.max(0, teacherWeeklyCapacity - unavailableCount);

    if (teacherAvailabilityEnabled && teacherAvailabilityHard && forced > teacherEffectiveCapacity) {
      warnings.push({
        severity: "error",
        type: "teacher_availability_forced_overload",
        message: `Teacher "${faculty.name || fid}" forced load ${forced} exceeds available capacity ${teacherEffectiveCapacity} after availability blocks.`,
      });
    }
    if (forced > teacherWeeklyCapacity) {
      warnings.push({
        severity: "error",
        type: "teacher_forced_overload",
        message: `Teacher "${faculty.name || fid}" forced load ${forced} exceeds capacity ${teacherWeeklyCapacity}.`,
      });
    } else if (estimated > teacherWeeklyCapacity) {
      warnings.push({
        severity: "warning",
        type: "teacher_potential_overload",
        message: `Teacher "${faculty.name || fid}" estimated load ${Math.ceil(estimated)} exceeds capacity ${teacherWeeklyCapacity} (upper-bound potential: ${potential}).`,
      });
    }

    const prefs = teacherPreferences.get(fid);
    if (prefs?.preferredDays?.length) {
      const preferredCapacity = prefs.preferredDays.length * usableSlotsPerDay;
      if (estimated > preferredCapacity) {
        warnings.push({
          severity: "info",
          type: "teacher_preferred_days_pressure",
          message: `Teacher "${faculty.name || fid}" prefers ${prefs.preferredDays.length} day(s), but estimated load ${Math.ceil(estimated)} likely spills outside preferred days.`,
        });
      }
    }
    if (prefs?.maxConsecutive === 1 && estimated > schedule.daysPerWeek) {
      warnings.push({
        severity: "info",
        type: "teacher_max_consecutive_pressure",
        message: `Teacher "${faculty.name || fid}" prefers max consecutive 1, which may be hard to satisfy with estimated load ${Math.ceil(estimated)}.`,
      });
    }
  }

  const weeklyBalanceEnabled = Boolean(weeklyBalanceCfg.enabled);
  if (weeklyBalanceEnabled) {
    const minWeeklyLoad = Math.max(0, toInt(weeklyBalanceCfg.minWeeklyLoad, 0));
    const maxWeeklyLoad = Math.max(0, toInt(weeklyBalanceCfg.maxWeeklyLoad, teacherWeeklyCapacity));
    const hardMin = Boolean(weeklyBalanceCfg.hardMin);
    const hardMax = Boolean(weeklyBalanceCfg.hardMax);

    if (hardMin) {
      const requiredMinLoad = faculties.length * minWeeklyLoad;
      if (requiredMinLoad > totalClassRequired) {
        warnings.push({
          severity: "warning",
          type: "weekly_min_load_high",
          message: `Hard minimum weekly load requires ${requiredMinLoad} teacher-hours but classes require ${totalClassRequired}.`,
        });
      }
    }
    if (hardMax && maxWeeklyLoad > teacherWeeklyCapacity) {
      warnings.push({
        severity: "warning",
        type: "weekly_max_exceeds_capacity",
        message: `Hard max weekly load ${maxWeeklyLoad} exceeds per-teacher slot capacity ${teacherWeeklyCapacity}.`,
      });
    }
    if (hardMax) {
      for (const faculty of faculties) {
        const fid = String(faculty._id);
        const forced = forcedTeacherLoad.get(fid) || 0;
        if (forced > maxWeeklyLoad) {
          warnings.push({
            severity: "error",
            type: "teacher_forced_above_hard_weekly_max",
            message: `Teacher "${faculty.name || fid}" has forced load ${forced}, above hard max weekly load ${maxWeeklyLoad}.`,
          });
        }
      }
    }
  }

  const fixedSlotsArray = Array.isArray(fixedSlots) ? fixedSlots : [];
  const classSlotOwner = new Map();
  const teacherSlotOwner = new Map();

  for (const fs of fixedSlotsArray) {
    const classId = String(fs?.class || "");
    const comboId = String(fs?.combo || "");
    const day = toInt(fs?.day, -1);
    const hour = toInt(fs?.hour, -1);
    if (!classId || !comboId) {
      warnings.push({
        severity: "warning",
        type: "fixed_slot_invalid",
        message: `Fixed slot has missing class/combo: ${JSON.stringify(fs)}`,
      });
      continue;
    }
    if (day < 0 || day >= schedule.daysPerWeek || hour < 0 || hour >= schedule.hoursPerDay) {
      warnings.push({
        severity: "warning",
        type: "fixed_slot_out_of_range",
        message: `Fixed slot out of range for class ${classId} at day ${day}, hour ${hour}.`,
      });
      continue;
    }
    if (breakSet.has(hour)) {
      warnings.push({
        severity: "warning",
        type: "fixed_slot_on_break",
        message: `Fixed slot for class ${classId} is on break hour ${hour}.`,
      });
    }

    const classKey = `${classId}|${day}|${hour}`;
    const existingClassCombo = classSlotOwner.get(classKey);
    if (existingClassCombo && existingClassCombo !== comboId) {
      warnings.push({
        severity: "error",
        type: "fixed_slot_class_conflict",
        message: `Class ${classId} has multiple fixed combos at day ${day}, hour ${hour}.`,
      });
    } else {
      classSlotOwner.set(classKey, comboId);
    }

    const combo = comboById.get(comboId);
    if (!combo) {
      warnings.push({
        severity: "warning",
        type: "fixed_slot_unknown_combo",
        message: `Fixed slot references unknown combo ${comboId}.`,
      });
      continue;
    }

    const classIds = (combo.class_ids || []).map(String);
    if (classIds.length > 0 && !classIds.includes(classId)) {
      warnings.push({
        severity: "warning",
        type: "fixed_slot_class_combo_mismatch",
        message: `Combo ${comboId} is not mapped to class ${classId}.`,
      });
    }

    for (const fid of getComboFacultyIds(combo)) {
      const teacherKey = `${fid}|${day}|${hour}`;
      const existing = teacherSlotOwner.get(teacherKey);
      if (existing && existing !== comboId) {
        warnings.push({
          severity: "error",
          type: "fixed_slot_teacher_conflict",
          message: `Teacher ${fid} has conflicting fixed slots at day ${day}, hour ${hour}.`,
        });
      } else {
        teacherSlotOwner.set(teacherKey, comboId);
      }
    }
  }

  if (classDailyMinCfg.enabled && classDailyMinCfg.hard) {
    const minPerDay = Math.max(0, toInt(classDailyMinCfg.minPerDay, 0));
    for (const cls of classes) {
      const days = Math.max(1, toInt(cls.days_per_week, schedule.daysPerWeek));
      const classSubjectHours =
        cls?.subject_hours && typeof cls.subject_hours === "object" && !Array.isArray(cls.subject_hours)
          ? cls.subject_hours
          : null;
      const classRequired =
        classSubjectHours && Object.keys(classSubjectHours).length > 0
          ? Object.values(classSubjectHours).reduce((acc, val) => acc + Math.max(0, toInt(val, 0)), 0)
          : subjects.reduce((acc, subj) => acc + requiredHoursFor(cls, subj), 0);
      if (minPerDay > usableSlotsPerDay) {
        warnings.push({
          severity: "error",
          type: "class_daily_min_exceeds_capacity",
          message: `Class "${cls.name || cls._id}" hard minimum ${minPerDay} per day exceeds usable daily slots ${usableSlotsPerDay}.`,
        });
      }
      if (weeklySubjectHoursCfg.hard !== false && classRequired < days * minPerDay) {
        warnings.push({
          severity: "warning",
          type: "class_daily_min_conflicts_with_required_hours",
          message: `Class "${cls.name || cls._id}" required ${classRequired} hours is below hard daily minimum total ${days * minPerDay}.`,
        });
      }
    }
  }

  const summary = {
    totalClasses: classes.length,
    totalTeachers: faculties.length,
    totalSubjects: subjects.length,
    totalCombos: combos.length,
    totalFixedSlots: fixedSlotsArray.length,
    schedule: {
      daysPerWeek: schedule.daysPerWeek,
      hoursPerDay: schedule.hoursPerDay,
      usableSlotsPerDay,
      breakHours: Array.from(breakSet).sort((a, b) => a - b),
    },
    totalClassRequiredHours: totalClassRequired,
    totalClassCapacityHours: totalClassCapacity,
    errors: warnings.filter((w) => w.severity === "error").length,
    warnings: warnings.filter((w) => w.severity === "warning").length,
  };

  return {
    ok: summary.errors === 0,
    summary,
    warnings,
  };
}
