// convertNewCollegeInputToGeneratorData.js

const MAX_ELECTIVE_COMBINATIONS = 50; // Performance safeguard

function getKCombinations(arr, k) {
    if (k > arr.length || k <= 0) return [];
    if (k === arr.length) return [arr];
    if (k === 1) return arr.map(item => [item]);
    const combs = [];
    for (let i = 0; i <= arr.length - k; i++) {
        const head = arr.slice(i, i + 1);
        const tailcombs = getKCombinations(arr.slice(i + 1), k - 1);
        for (const tail of tailcombs) { combs.push(head.concat(tail)); }
    }
    return combs;
}

// Correctly generates the cartesian product for elective teacher combinations
function generateElectiveCartesian(requirements, teachersByCategory) {
    const categories = Object.keys(requirements);
    let results = [[]]; // Start with an array containing an empty set

    for (const subjectId of categories) {
        const teachersForCategory = teachersByCategory.get(subjectId) || [];
        const requiredCount = requirements[subjectId] || 1;

        if (teachersForCategory.length < requiredCount) {
            return []; // Not possible to create combos
        }

        // Get all unique sets of teachers for the current category (e.g., all combinations of 1 from the list)
        const combinationsForCategory = getKCombinations(teachersForCategory, requiredCount);

        const nextResults = [];
        // For each existing result, create new results by appending the combinations from the current category
        for (const existingResult of results) {
            for (const newGroup of combinationsForCategory) {
                const combined = [...existingResult, ...newGroup];
                // Ensure that a teacher is not used in multiple categories for the same elective combo
                if (new Set(combined).size === combined.length) {
                    nextResults.push(combined);
                }
            }
        }
        results = nextResults;
    }

    return results;
}

function getUniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}


export function convertNewCollegeInput({
    classes,
    subjects,
    teachers,
    classSubjects,
    classTeachers,
    teacherSubjectCombos = [],
    labAllocations = [],
    classElectiveSubjects = []
}) {

    //------------------------------------------------------------
    // Normalize & Create Lookups
    //------------------------------------------------------------
    classes = classes.map(c => ({ ...c, _id: String(c._id) }));
    subjects = subjects.map(s => ({ ...s, _id: String(s._id) }));
    teachers = teachers.map(t => ({ ...t, _id: String(t._id) }));

    const classById = new Map(classes.map(c => [String(c._id), c]));
    const subjectById = new Map(subjects.map(s => [String(s._id), s]));
    const formatClassLabel = (c) => {
        if (!c) return "unknown";
        const name = c.name || c.id || c._id;
        const sem = c.sem ?? "?";
        const section = c.section ? `, Sec ${c.section}` : "";
        return `${name} (Sem ${sem}${section})`;
    };
    
    const teachersByCategory = new Map();
    const explicitAllocations = [];
    const explicitLabAllocations = [];
    const explicitElectiveAllocations = [];
    for (const allocation of labAllocations) {
        const classIds = getUniqueStrings(allocation.classIds);
        const subjectId = String(allocation.subjectId || "").trim();
        const teacherIds = getUniqueStrings(allocation.teacherIds);
        const hoursRequired = Number(allocation.hoursPerWeek || 0);
        if (!subjectId || classIds.length === 0 || hoursRequired <= 0) continue;
        explicitLabAllocations.push({
            teacherId: teacherIds[0] || null,
            teacherIds,
            subjectId,
            classIds,
            hoursPerWeek: hoursRequired,
            combinedClassGroupId: allocation.combinedClassGroupId || null,
        });
    }
    for (const combo of teacherSubjectCombos) {
        const subjectIdStr = String(combo.subjectId);
        const teacherIds = Array.isArray(combo.teacherIds) && combo.teacherIds.length > 0
            ? combo.teacherIds.map(String)
            : combo.teacherId
                ? [String(combo.teacherId)]
                : [];
        const comboType = String(combo.type || "").toUpperCase();
        if (comboType === "ELECTIVE") {
            const classIds = getUniqueStrings(combo.classIds);
            const subjectTeacherPairs = (Array.isArray(combo.subjectTeacherPairs) ? combo.subjectTeacherPairs : [])
                .map((pair) => ({
                    subjectId: String(pair?.subjectId || pair?.subject || "").trim(),
                    teacherId: String(pair?.teacherId || pair?.teacher || "").trim(),
                }))
                .filter((pair) => {
                    if (!pair.subjectId) return false;
                    if (pair.teacherId) return true;
                    const subject = subjectById.get(pair.subjectId);
                    return String(subject?.type || "").toLowerCase() === "no_teacher";
                });
            const groupTeacherIds = getUniqueStrings([
                ...teacherIds,
                ...subjectTeacherPairs.map((pair) => pair.teacherId),
            ]);
            const hoursRequired = Number(combo.hoursPerWeek || 0);
            if (classIds.length > 0 && subjectTeacherPairs.length > 0 && hoursRequired > 0) {
                explicitElectiveAllocations.push({
                    classIds,
                    subjectId: subjectIdStr,
                    teacherIds: groupTeacherIds,
                    subjectTeacherPairs,
                    hoursPerWeek: hoursRequired,
                    isLab: Boolean(combo.isLab),
                    electiveGroupId: String(combo.electiveGroupId || combo.combinedClassGroupId || subjectTeacherPairs.map((pair) => pair.subjectId).join("_")),
                    combinedClassGroupId: combo.combinedClassGroupId || null,
                });
            }
            subjectTeacherPairs.forEach((pair) => {
                if (!teachersByCategory.has(pair.subjectId)) {
                    teachersByCategory.set(pair.subjectId, []);
                }
                teachersByCategory.get(pair.subjectId).push(pair.teacherId);
            });
            continue;
        }
        if (Array.isArray(combo.classIds) && combo.classIds.length > 0) {
            explicitAllocations.push({
                teacherId: teacherIds[0] || null,
                teacherIds,
                subjectId: subjectIdStr,
                classIds: combo.classIds.map(String),
                hoursPerWeek: Number(combo.hoursPerWeek || 0),
                combinedClassGroupId: combo.combinedClassGroupId || null,
            });
        }
        if (teacherIds.length === 0) {
            continue;
        }
        if (!teachersByCategory.has(subjectIdStr)) {
            teachersByCategory.set(subjectIdStr, []);
        }
        teacherIds.forEach((teacherId) => {
            teachersByCategory.get(subjectIdStr).push(String(teacherId));
        });
    }
    explicitAllocations.unshift(...explicitLabAllocations);

    // Create virtual subjects for combined NORMAL classes to preserve the Combination ID name
    const combinedNormalVirtualSubjects = [];
    for (const allocation of explicitAllocations) {
        const classIds = [...new Set((allocation.classIds || []).map(String))].sort();
        if (classIds.length > 1 && allocation.combinedClassGroupId) {
            const subjectId = String(allocation.subjectId);
            const virtualSubId = `VIRTUAL_COMBINED_${classIds.join("_")}_${allocation.combinedClassGroupId}`;
            const exists = combinedNormalVirtualSubjects.some(s => s._id === virtualSubId);
            if (!exists) {
                const baseSubject = subjectById.get(subjectId);
                combinedNormalVirtualSubjects.push({
                    _id: virtualSubId,
                    name: `${allocation.combinedClassGroupId} (${baseSubject?.name || "Subject"})`,
                    no_of_hours_per_week: Number(allocation.hoursPerWeek || 0),
                    type: baseSubject?.type || "theory",
                    isVirtual: true,
                });
            }
        }
    }

    const subjectsPerClass = {}, teachersPerClass = {}, hoursPerClassSubject = {};
    for (const cs of classSubjects) {
        const classIdStr = String(cs.classId), subjectIdStr = String(cs.subjectId);
        if (!subjectsPerClass[classIdStr]) { subjectsPerClass[classIdStr] = []; }
        subjectsPerClass[classIdStr].push(subjectIdStr);
        hoursPerClassSubject[`${classIdStr}|${subjectIdStr}`] = cs.hoursPerWeek;
    }
    for (const ct of classTeachers) {
        const classIdStr = String(ct.classId);
        if (!teachersPerClass[classIdStr]) { teachersPerClass[classIdStr] = []; }
        teachersPerClass[classIdStr].push(String(ct.teacherId));
    }

    //------------------------------------------------------------
    // 1. Create Virtual Subjects for Electives
    //------------------------------------------------------------
    const virtualSubjects = [], electiveGroupsByClass = new Map(), realSubjectsInElectives = new Set();
    const explicitElectiveGroupsByClass = new Map();
    for (const setting of classElectiveSubjects) {
        const classId = String(setting.classId);
        const requirements = setting.teacherCategoryRequirements || {};
        const requiredSubjectIds = Object.keys(requirements);
        if (requiredSubjectIds.length === 0) continue;
        
        // Fix 1 & 2: Use a class-scoped key for the placeholder "elective" subject
        const placeholderElectiveId = String(setting.subjectId);
        realSubjectsInElectives.add(`${classId}|${placeholderElectiveId}`);

        const placeholderElective = subjectById.get(placeholderElectiveId);
        const placeholderElectiveName = placeholderElective?.name || `Elective ${placeholderElectiveId.slice(-4)}`;
        const subjectNames = requiredSubjectIds
            .map(id => subjectById.get(String(id))?.name)
            .filter(Boolean)
            .join(" + ");
        const virtualSubjectId = `VIRTUAL_ELECTIVE_${classId}_PLACEHOLDER_${placeholderElectiveId}_${requiredSubjectIds.sort().join('_')}`;
        const virtualSub = {
            _id: virtualSubjectId,
            name: subjectNames
                ? `${placeholderElectiveName} (${subjectNames})`
                : placeholderElectiveName,
            no_of_hours_per_week: hoursPerClassSubject[`${classId}|${placeholderElectiveId}`] || 0,
            isVirtual: true,
        };
        virtualSubjects.push(virtualSub);

        if (!electiveGroupsByClass.has(classId)) { electiveGroupsByClass.set(classId, []); }
        electiveGroupsByClass.get(classId).push({
            virtualSubjectId: virtualSub._id,
            hours: virtualSub.no_of_hours_per_week,
            requirements,
        });
    }
    for (const allocation of explicitElectiveAllocations) {
        const classIds = getUniqueStrings(allocation.classIds);
        const teacherIds = getUniqueStrings(allocation.teacherIds);
        const subjectTeacherPairs = allocation.subjectTeacherPairs || [];
        const hoursRequired = Number(allocation.hoursPerWeek || 0);
        if (!classIds.length || !teacherIds.length || !subjectTeacherPairs.length || hoursRequired <= 0) continue;

        const subjectIds = getUniqueStrings(subjectTeacherPairs.map((pair) => pair.subjectId)).sort();
        const subjectNames = subjectIds
            .map(id => subjectById.get(String(id))?.name)
            .filter(Boolean)
            .join(" + ");
        const groupId = String(allocation.electiveGroupId || subjectIds.join("_"));
        const virtualSubjectId = `VIRTUAL_DIRECT_ELECTIVE_${classIds.join("_")}_${groupId}_${subjectIds.join("_")}`;
        const virtualSub = {
            _id: virtualSubjectId,
            name: subjectNames
                ? `${allocation.isLab ? "Elective Lab Block" : "Elective Block"} (${subjectNames})`
                : `${allocation.isLab ? "Elective Lab Block" : "Elective Block"} ${groupId}`,
            no_of_hours_per_week: hoursRequired,
            type: allocation.isLab ? "lab" : "theory",
            isVirtual: true,
        };
        virtualSubjects.push(virtualSub);
        classIds.forEach((classId) => {
            subjectIds.forEach((subjectId) => realSubjectsInElectives.add(`${classId}|${subjectId}`));
        });
        const classKey = classIds.join("|");
        if (!explicitElectiveGroupsByClass.has(classKey)) {
            explicitElectiveGroupsByClass.set(classKey, []);
        }
        explicitElectiveGroupsByClass.get(classKey).push({
            classIds,
            facultyIds: teacherIds,
            virtualSubjectId,
            hours: hoursRequired,
            combinedClassGroupId: allocation.combinedClassGroupId || null,
            groupId,
        });
    }

    const subjectsOut = [...subjects, ...virtualSubjects, ...combinedNormalVirtualSubjects], combos = [];
    const subjectOutById = new Map(subjectsOut.map(subject => [String(subject._id), subject]));
    let comboIndex = 1;
    const buildComboSubject = (subjectId) => {
        const subject = subjectOutById.get(String(subjectId));
        return {
            _id: String(subjectId),
            name: subject?.name || `Subject ${String(subjectId).slice(-4)}`,
            type: subject?.type || "theory",
            isVirtual: Boolean(subject?.isVirtual),
        };
    };

    //------------------------------------------------------------
    // 2. Generate ALL Combos
    //------------------------------------------------------------

    const explicitAllocationKeys = new Set();
    const explicitCoveredClassSubjectKeys = new Set();
    for (const electiveGroups of explicitElectiveGroupsByClass.values()) {
        for (const electiveGroup of electiveGroups) {
            const classIds = [...electiveGroup.classIds].sort();
            classIds.forEach((classId) => explicitCoveredClassSubjectKeys.add(`${classId}|${electiveGroup.virtualSubjectId}`));
            combos.push({
                _id: "C" + comboIndex++,
                faculty_ids: [...electiveGroup.facultyIds].sort(),
                subject_id: electiveGroup.virtualSubjectId,
                subject: buildComboSubject(electiveGroup.virtualSubjectId),
                class_ids: classIds,
                combined_class_group_id: electiveGroup.combinedClassGroupId,
                elective_group_id: electiveGroup.groupId,
                hours_per_week: electiveGroup.hours,
                hours_per_class: Object.fromEntries(classIds.map((classId) => [classId, electiveGroup.hours])),
                combo_name: `ELECTIVE_GROUP_${electiveGroup.groupId}_${classIds.join("_")}`,
            });
        }
    }
    for (const allocation of explicitAllocations) {
        const classIds = [...new Set((allocation.classIds || []).map(String))].sort();
        const subjectId = String(allocation.subjectId);
        if (!subjectId || classIds.length === 0) continue;
        if (classIds.some((classId) => realSubjectsInElectives.has(`${classId}|${subjectId}`))) {
            continue;
        }
        const hoursRequired = Number(allocation.hoursPerWeek || 0);
        if (hoursRequired <= 0) continue;

        let effectiveSubjectId = subjectId;
        if (classIds.length > 1 && allocation.combinedClassGroupId) {
            effectiveSubjectId = `VIRTUAL_COMBINED_${classIds.join("_")}_${allocation.combinedClassGroupId}`;
        }

        classIds.forEach((classId) => explicitCoveredClassSubjectKeys.add(`${classId}|${effectiveSubjectId}`));
        const facultyIds = [...new Set((allocation.teacherIds || []).map(String))].sort();
        const key = `${facultyIds.join("+")}|${effectiveSubjectId}|${classIds.join(",")}|${allocation.combinedClassGroupId || ""}`;
        if (explicitAllocationKeys.has(key)) continue;
        explicitAllocationKeys.add(key);
        combos.push({
            _id: "C" + comboIndex++,
            faculty_ids: facultyIds,
            subject_id: effectiveSubjectId,
            subject: buildComboSubject(effectiveSubjectId),
            class_ids: classIds,
            combined_class_group_id: allocation.combinedClassGroupId || null,
            hours_per_week: hoursRequired,
            hours_per_class: Object.fromEntries(classIds.map((classId) => [classId, hoursRequired])),
            combo_name: allocation.combinedClassGroupId
                ? `GROUP_${allocation.combinedClassGroupId}`
                : facultyIds.length > 0
                    ? `T${facultyIds.join("_")}_S${effectiveSubjectId}_C${classIds.join("_")}`
                    : `NT_S${effectiveSubjectId}_C${classIds.join("_")}`
        });
    }

    // Stage A: Generate NORMAL, single-teacher combos for legacy mappings not covered by explicit allocations
    for (const cs of classSubjects) {
        const classId = String(cs.classId), subjectId = String(cs.subjectId);
        if (realSubjectsInElectives.has(`${classId}|${subjectId}`)) {
            continue;
        }
        if (explicitCoveredClassSubjectKeys.has(`${classId}|${subjectId}`)) {
            continue;
        }
        const hoursRequired = hoursPerClassSubject[`${classId}|${subjectId}`] || 0;
        if (hoursRequired <= 0) continue;
        const teachersForSubject = teachersByCategory.get(subjectId) || [];
        const teachersForClass = teachersPerClass[classId] || [];
        const eligibleTeachers = teachersForClass.length > 0
            ? teachersForSubject.filter(tid => teachersForClass.includes(tid))
            : teachersForSubject;
        const subjectType = String(subjectById.get(subjectId)?.type || "").toLowerCase();
        if (subjectType === "no_teacher") {
            combos.push({
                _id: "C" + comboIndex++, faculty_ids: [], subject_id: subjectId, subject: buildComboSubject(subjectId), class_ids: [classId],
                hours_per_week: hoursRequired, hours_per_class: { [classId]: hoursRequired },
                combo_name: `NT_S${subjectId}_C${classId}`
            });
            continue;
        }
        for (const teacherId of eligibleTeachers) {
            combos.push({
                _id: "C" + comboIndex++, faculty_ids: [teacherId], subject_id: subjectId, subject: buildComboSubject(subjectId), class_ids: [classId],
                hours_per_week: hoursRequired, hours_per_class: { [classId]: hoursRequired },
                combo_name: `T${teacherId}_S${subjectId}_C${classId}`
            });
        }
    }
    
    // Stage B: Generate VIRTUAL, multi-teacher combos for ELECTIVES
    for (const [classId, electiveGroups] of electiveGroupsByClass.entries()) {
        for (const electiveGroup of electiveGroups) {
            const classTeachForThisClass = teachersPerClass[classId] || [];
            const teachersForClassByCategory = new Map();
            for(const [subId, teacherList] of teachersByCategory.entries()){
                if (classTeachForThisClass.length > 0) {
                    teachersForClassByCategory.set(subId, teacherList.filter(tid => classTeachForThisClass.includes(tid)));
                } else {
                    teachersForClassByCategory.set(subId, teacherList);
                }
            }

            // Pre-check elective requirements to log detailed context
            let hasShortage = false;
            for (const [subId, requiredCount] of Object.entries(electiveGroup.requirements || {})) {
                const availableCount = (teachersForClassByCategory.get(subId) || []).length;
                if (availableCount < requiredCount) {
                    const cls = classById.get(String(classId));
                    const subj = subjectById.get(String(subId));
                    console.warn(
                        `Elective teacher shortage: class=${formatClassLabel(cls)} classId=${classId} ` +
                        `subject=${subj?.name || subId} subjectId=${subId} required=${requiredCount} available=${availableCount}`
                    );
                    hasShortage = true;
                }
            }
            if (hasShortage) {
                continue;
            }
            
            // FIX: Use generateElectiveCartesian for elective combos
            let allFacultyCombinations = generateElectiveCartesian(electiveGroup.requirements, teachersForClassByCategory);
            
            if (allFacultyCombinations.length > MAX_ELECTIVE_COMBINATIONS) {
                console.warn(`Warning: Too many elective combinations (${allFacultyCombinations.length}) for class ${classId}. Truncating to ${MAX_ELECTIVE_COMBINATIONS}.`);
                allFacultyCombinations.length = MAX_ELECTIVE_COMBINATIONS;
            }
            for (const facultyIds of allFacultyCombinations) {
                if (facultyIds.length > 0) {
                    combos.push({
                        _id: "C" + comboIndex++, faculty_ids: facultyIds.sort(), subject_id: electiveGroup.virtualSubjectId, subject: buildComboSubject(electiveGroup.virtualSubjectId),
                        class_ids: [classId], hours_per_week: electiveGroup.hours,
                        hours_per_class: { [classId]: electiveGroup.hours },
                        combo_name: `ELECTIVE_${classId}_${facultyIds.join("_")}`
                    });
                }
            }
        }
    }
    
    console.log(`[convertNewCollegeInput] Generated a total of ${combos.length} combos.`);

    //------------------------------------------------------------
    // 3. Finalize Output
    //------------------------------------------------------------
    const classesOut = classes.map(c => {
        const classId = c._id;
        const subject_hours = {};
        const coveredByExplicit = new Set();

        // 1. Prioritize hours from explicit allocations (Direct/Manual/Sync)
        for (const alloc of explicitAllocations) {
            const allocClassIds = [...new Set((alloc.classIds || []).map(String))].sort();
            if (allocClassIds.includes(classId)) {
                let sid = String(alloc.subjectId);
                if (allocClassIds.length > 1 && alloc.combinedClassGroupId) {
                    sid = `VIRTUAL_COMBINED_${allocClassIds.join("_")}_${alloc.combinedClassGroupId}`;
                }
                subject_hours[sid] = (subject_hours[sid] || 0) + (alloc.hoursPerWeek || 0);
                coveredByExplicit.add(sid);
            }
        }

        // 2. Fallback to legacy mappings for subjects not covered by explicit allocations
        (subjectsPerClass[classId] || []).forEach(sid => {
            if (!coveredByExplicit.has(sid) && !realSubjectsInElectives.has(`${classId}|${sid}`)) {
                subject_hours[sid] = (subject_hours[sid] || 0) + (hoursPerClassSubject[`${classId}|${sid}`] || 0);
            }
        });

        // 3. Add elective groups
        (electiveGroupsByClass.get(classId) || []).forEach(eg => {
            subject_hours[eg.virtualSubjectId] = (subject_hours[eg.virtualSubjectId] || 0) + (eg.hours || 0);
        });
        for (const electiveGroups of explicitElectiveGroupsByClass.values()) {
            electiveGroups
                .filter((eg) => eg.classIds.includes(classId))
                .forEach((eg) => {
                    subject_hours[eg.virtualSubjectId] = (subject_hours[eg.virtualSubjectId] || 0) + (eg.hours || 0);
                });
        }

        return {
            _id: classId,
            id: classId,
            name: c.name,
            sem: c.sem,
            section: c.section || "",
            days_per_week: Number(c.days_per_week || 5),
            assigned_teacher_subject_combos: combos.filter(combo => combo.class_ids.includes(classId)).map(combo => combo._id),
            subject_hours,
            total_class_hours: Object.values(subject_hours).reduce((a, b) => a + b, 0)
        };
    });

    return {
        faculties: teachers.map(t => ({
            _id: t._id,
            name: t.name || "",
            unavailableSlots: Array.isArray(t.unavailableSlots) ? t.unavailableSlots : [],
            preferences: t.preferences || {},
        })),
        subjects: subjectsOut,
        classes: classesOut,
        combos
    };
}
export default { convertNewCollegeInput };
