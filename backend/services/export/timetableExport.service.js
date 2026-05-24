import mongoose from "mongoose";
import ExcelJS from "exceljs";
import ClassModel from "../../models/Class.js";
import Faculty from "../../models/Faculty.js";
import Subject from "../../models/Subject.js";
import TeacherSubjectCombination from "../../models/TeacherSubjectCombination.js";
import { buildSubjectMap, getComboSubjectDisplayName } from "../../utils/subjectDisplay.js";

const DEFAULT_DAY_LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const MODE_BUILDERS = {
  class: buildClassSheets,
  teacher: buildTeacherSheets,
  full: buildFullSheet,
};

export async function exportTimetableExcel({ timetable, mode, filters = {} }) {
  const normalizedMode = String(mode || "class").toLowerCase();
  const builder = MODE_BUILDERS[normalizedMode];

  if (!builder) {
    throw new Error(`Unsupported export mode: ${mode}`);
  }

  const context = await buildExportContext(timetable, filters);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Timetable ERP";
  workbook.created = new Date();
  workbook.modified = new Date();

  await builder(workbook, context);
  return workbook;
}

async function buildExportContext(timetable, filters = {}) {
  const { days, hours } = getScheduleDimensions(timetable);
  let classTables = normalizeTables(timetable?.class_timetables || {}, days, hours);
  
  // Apply class filter if present
  if (filters.classId) {
    const filteredTables = {};
    if (classTables[filters.classId]) {
      filteredTables[filters.classId] = classTables[filters.classId];
    }
    classTables = filteredTables;
  }

  const classIds = Object.keys(classTables);

  const slotComboIds = collectSlotComboIds(classTables);
  const comboMap = await buildComboMap(timetable, slotComboIds);

  const classIdsFromCombos = new Set(classIds);
  const facultyIds = new Set();
  const subjectIds = new Set();

  for (const combo of comboMap.values()) {
    for (const classId of getClassIds(combo)) classIdsFromCombos.add(classId);
    for (const facultyId of getFacultyIds(combo)) facultyIds.add(facultyId);

    const subjectId = getSubjectId(combo);
    if (subjectId && mongoose.Types.ObjectId.isValid(subjectId)) {
      subjectIds.add(subjectId);
    }
  }

  const [classDocs, facultyDocs, subjectDocs] = await Promise.all([
    loadDocs(ClassModel, classIdsFromCombos),
    loadDocs(Faculty, facultyIds),
    loadDocs(Subject, subjectIds),
  ]);

  const classMap = new Map(
    classDocs.map((classDoc) => [String(classDoc._id), formatClassName(classDoc)])
  );
  const facultyMap = new Map();
  for (const facultyDoc of facultyDocs) {
    facultyMap.set(
      String(facultyDoc._id),
      facultyDoc.name || `Faculty ${String(facultyDoc._id).slice(-4)}`
    );
  }

  const persistedSubjectMap = buildSubjectMap(timetable?.subjects || []);
  const subjectMap = new Map(
    subjectDocs.map((subjectDoc) => [String(subjectDoc._id), subjectDoc.name || `Subject ${String(subjectDoc._id).slice(-4)}`])
  );
  for (const [subjectId, subject] of persistedSubjectMap.entries()) {
    subjectMap.set(subjectId, getComboSubjectDisplayName(subject, null, `Subject ${subjectId.slice(-4)}`));
  }
  const subjectTypeMap = new Map(
    subjectDocs.map((subjectDoc) => [String(subjectDoc._id), String(subjectDoc.type || "").toLowerCase()])
  );
  for (const [subjectId, subject] of persistedSubjectMap.entries()) {
    subjectTypeMap.set(subjectId, String(subject?.type || "").toLowerCase());
  }

  const comboMetaMap = new Map();
  for (const [comboId, combo] of comboMap.entries()) {
    const subjectId = getSubjectId(combo);
    const facultyIdList = getFacultyIds(combo);
    const classIdList = getClassIds(combo);
    const subjectType = subjectTypeMap.get(subjectId) || String(combo?.subject?.type || "").toLowerCase();
    const subjectName = getComboSubjectDisplayName(
      combo,
      new Map([
        ...subjectMap.entries(),
        ...persistedSubjectMap.entries(),
      ]),
      subjectMap.get(subjectId) || "Unknown Subject"
    );

    let teacherNames = facultyIdList
      .map((facultyId) => facultyMap.get(facultyId) || `Faculty ${facultyId.slice(-4)}`)
      .filter(Boolean);

    if (!teacherNames.length && subjectType === "no_teacher") {
      teacherNames = ["No Teacher"];
    }

    const classNames = classIdList
      .map((classId) => classMap.get(classId) || `Class ${classId.slice(-4)}`)
      .filter(Boolean);

    // Check if combo matches faculty/subject filters
    let matchesFilters = true;
    if (filters.facultyId) {
      matchesFilters = facultyIdList.some(id => String(id) === String(filters.facultyId));
    }
    if (matchesFilters && filters.subjectId) {
      matchesFilters = String(subjectId) === String(filters.subjectId);
    }

    comboMetaMap.set(comboId, {
      comboId,
      subjectId,
      subjectName,
      facultyIds: facultyIdList,
      teacherNames,
      classIds: classIdList,
      classNames,
      matchesFilters,
    });
  }

  const teacherViews = buildTeacherViews(classTables, comboMetaMap, classMap, days, hours);
  
  // If teacher filter is active, only keep that teacher's view
  if (filters.facultyId && teacherViews[filters.facultyId]) {
    const singleTeacherView = {};
    singleTeacherView[filters.facultyId] = teacherViews[filters.facultyId];
  }

  const dayLabels = buildDayLabels(days);
  const periodLabels = Array.from({ length: hours }, (_, index) => `P${index + 1}`);

  return {
    days,
    hours,
    dayLabels,
    periodLabels,
    classTables,
    classMap,
    comboMetaMap,
    teacherViews,
    teacherNameMap: facultyMap,
    filters,
  };
}

async function buildClassSheets(workbook, context) {
  const usedNames = new Set();
  let sortedClassIds = [...Object.keys(context.classTables)].sort((left, right) =>
    (context.classMap.get(left) || left).localeCompare(context.classMap.get(right) || right)
  );

  if (!sortedClassIds.length) {
    const sheet = workbook.addWorksheet("Class Timetable");
    sheet.addRow(["No class timetable data available"]);
    return;
  }

  for (const classId of sortedClassIds) {
    const className = context.classMap.get(classId) || `Class ${classId.slice(-4)}`;
    const sheet = workbook.addWorksheet(makeSheetName(className, usedNames));
    sheet.addRow(["Day", ...context.periodLabels]);

    for (let dayIndex = 0; dayIndex < context.days; dayIndex += 1) {
      const row = [context.dayLabels[dayIndex]];

      for (let hourIndex = 0; hourIndex < context.hours; hourIndex += 1) {
        row.push(
          formatClassSlotCell(context.classTables[classId]?.[dayIndex]?.[hourIndex], context.comboMetaMap)
        );
      }

      sheet.addRow(row);
    }

    styleWorksheet(sheet, context.periodLabels.length + 1, {
      table: context.classTables[classId],
      comboMetaMap: context.comboMetaMap,
      hasFilters: !!(context.filters.facultyId || context.filters.subjectId)
    });
  }
}

async function buildTeacherSheets(workbook, context) {
  const usedNames = new Set();
  let teacherIds = Object.keys(context.teacherViews);
  
  if (context.filters.facultyId) {
    teacherIds = teacherIds.filter(id => String(id) === String(context.filters.facultyId));
  }

  teacherIds.sort((left, right) =>
    (context.teacherNameMap.get(left) || left).localeCompare(context.teacherNameMap.get(right) || right)
  );

  if (!teacherIds.length) {
    const sheet = workbook.addWorksheet("Teacher Timetable");
    sheet.addRow(["No teacher timetable data available"]);
    return;
  }

  for (const teacherId of teacherIds) {
    const teacherName = context.teacherNameMap.get(teacherId) || `Teacher ${teacherId.slice(-4)}`;
    const sheet = workbook.addWorksheet(makeSheetName(teacherName, usedNames));
    sheet.addRow(["Day", ...context.periodLabels]);

    for (let dayIndex = 0; dayIndex < context.days; dayIndex += 1) {
      const row = [context.dayLabels[dayIndex]];

      for (let hourIndex = 0; hourIndex < context.hours; hourIndex += 1) {
        const entries = context.teacherViews[teacherId]?.[dayIndex]?.[hourIndex] || [];
        // For teacher sheets, we filter entries that match subject filter if present
        const filteredEntries = context.filters.subjectId 
          ? entries.filter(e => {
              const meta = context.comboMetaMap.get(e.comboId);
              return meta && String(meta.subjectId) === String(context.filters.subjectId);
            })
          : entries;

        row.push(
          filteredEntries
            .map((entry) => `${entry.subjectName}\n${entry.classNames.join(", ")}`)
            .join("\n\n")
        );
      }

      sheet.addRow(row);
    }

    styleWorksheet(sheet, context.periodLabels.length + 1);
  }
}

async function buildFullSheet(workbook, context) {
  const sheet = workbook.addWorksheet("Full Timetable");
  sheet.addRow(["Class", "Day", ...context.periodLabels]);

  let sortedClassIds = [...Object.keys(context.classTables)].sort((left, right) =>
    (context.classMap.get(left) || left).localeCompare(context.classMap.get(right) || right)
  );

  const hasFilters = !!(context.filters.facultyId || context.filters.subjectId);

  for (const classId of sortedClassIds) {
    const className = context.classMap.get(classId) || `Class ${classId.slice(-4)}`;

    for (let dayIndex = 0; dayIndex < context.days; dayIndex += 1) {
      const row = [className, context.dayLabels[dayIndex]];

      for (let hourIndex = 0; hourIndex < context.hours; hourIndex += 1) {
        row.push(
          formatClassSlotCell(
            context.classTables[classId]?.[dayIndex]?.[hourIndex],
            context.comboMetaMap,
            { includeClassNames: false }
          )
        );
      }

      const excelRow = sheet.addRow(row);

      if (hasFilters) {
        for (let hourIndex = 0; hourIndex < context.hours; hourIndex += 1) {
          const slot = context.classTables[classId]?.[dayIndex]?.[hourIndex];
          const comboIds = getSlotComboIds(slot);
          const isMatch = comboIds.some(cid => context.comboMetaMap.get(cid)?.matchesFilters);
          
          if (comboIds.length > 0 && !isMatch) {
            const cell = excelRow.getCell(hourIndex + 3);
            cell.font = { color: { argb: "FFAAAAAA" } };
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF9F9F9" },
            };
          }
        }
      }
    }

    sheet.addRow([]);
  }

  styleWorksheet(sheet, context.periodLabels.length + 2);
}

function getScheduleDimensions(timetable) {
  const schedule = timetable?.config?.schedule || {};
  const days =
    Number(schedule.daysPerWeek) ||
    Number(timetable?.config?.days) ||
    Number(timetable?.config?.daysPerWeek) ||
    6;
  const hours =
    Number(schedule.hoursPerDay) ||
    Number(timetable?.config?.hours) ||
    Number(timetable?.config?.hoursPerDay) ||
    8;

  return { days, hours };
}

function inferDaysFromTables(tables) {
  const rows = Object.values(tables || {}).map((table) =>
    Array.isArray(table) ? table.length : Object.keys(table || {}).length
  );
  return rows.length ? Math.max(...rows) : 0;
}

function inferHoursFromTables(tables) {
  let maxHours = 0;

  for (const table of Object.values(tables || {})) {
    const rows = Array.isArray(table)
      ? table
      : Object.keys(table || {})
          .sort((left, right) => Number(left) - Number(right))
          .map((key) => table[key]);

    for (const row of rows) {
      const width = Array.isArray(row) ? row.length : Object.keys(row || {}).length;
      if (width > maxHours) {
        maxHours = width;
      }
    }
  }

  return maxHours;
}

function normalizeTables(tables, days, hours) {
  const out = {};

  for (const [ownerId, rawTable] of Object.entries(tables || {})) {
    const rows = Array.isArray(rawTable)
      ? rawTable
      : Object.keys(rawTable || {})
          .sort((left, right) => Number(left) - Number(right))
          .map((key) => rawTable[key]);

    out[ownerId] = Array.from({ length: days }, (_, dayIndex) => {
      const rawRow = rows[dayIndex];
      const slots = Array.isArray(rawRow)
        ? rawRow
        : Object.keys(rawRow || {})
            .sort((left, right) => Number(left) - Number(right))
            .map((key) => rawRow[key]);

      return Array.from({ length: hours }, (_, hourIndex) => slots[hourIndex] ?? null);
    });
  }

  return out;
}

function collectSlotComboIds(classTables) {
  const comboIds = new Set();

  for (const table of Object.values(classTables || {})) {
    for (const row of table || []) {
      for (const slot of row || []) {
        for (const comboId of getSlotComboIds(slot)) {
          comboIds.add(comboId);
        }
      }
    }
  }

  return comboIds;
}

async function buildComboMap(timetable, slotComboIds) {
  const comboMap = new Map();

  for (const combo of Array.isArray(timetable?.combos) ? timetable.combos : []) {
    if (combo?._id) {
      comboMap.set(String(combo._id), combo);
    }
  }

  const missingComboIds = [...slotComboIds].filter(
    (comboId) => !comboMap.has(comboId) && mongoose.Types.ObjectId.isValid(comboId)
  );

  if (!missingComboIds.length) {
    return comboMap;
  }

  const comboDocs = await TeacherSubjectCombination.find({
    _id: { $in: missingComboIds },
  })
    .populate("faculty", "name")
    .populate("subject", "name type")
    .lean();

  for (const combo of comboDocs) {
    comboMap.set(String(combo._id), combo);
  }

  return comboMap;
}

async function loadDocs(Model, ids) {
  const validIds = [...ids].filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!validIds.length) return [];
  return Model.find({ _id: { $in: validIds } }).lean();
}

function buildTeacherViews(classTables, comboMetaMap, classMap, days, hours) {
  const classesByComboSlot = new Map();

  for (const [classId, table] of Object.entries(classTables || {})) {
    for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
      for (let hourIndex = 0; hourIndex < hours; hourIndex += 1) {
        const slot = table?.[dayIndex]?.[hourIndex];
        for (const comboId of getSlotComboIds(slot)) {
          const key = `${comboId}|${dayIndex}|${hourIndex}`;
          if (!classesByComboSlot.has(key)) {
            classesByComboSlot.set(key, new Set());
          }
          classesByComboSlot.get(key).add(classId);
        }
      }
    }
  }

  const teacherViews = {};

  for (const [slotKey, classIds] of classesByComboSlot.entries()) {
    const [comboId, dayIndexValue, hourIndexValue] = slotKey.split("|");
    const dayIndex = Number(dayIndexValue);
    const hourIndex = Number(hourIndexValue);
    const meta = comboMetaMap.get(comboId);

    if (!meta || !meta.facultyIds.length) {
      continue;
    }

    const classNames = [...classIds]
      .map((classId) => classMap.get(classId) || `Class ${classId.slice(-4)}`)
      .sort((left, right) => left.localeCompare(right));

    for (const facultyId of meta.facultyIds) {
      if (!teacherViews[facultyId]) {
        teacherViews[facultyId] = createMatrix(days, hours, () => []);
      }

      teacherViews[facultyId][dayIndex][hourIndex].push({
        comboId,
        subjectName: meta.subjectName,
        classNames,
      });
    }
  }

  return teacherViews;
}

function createMatrix(days, hours, valueFactory) {
  return Array.from({ length: days }, () =>
    Array.from({ length: hours }, () => valueFactory())
  );
}

function formatClassSlotCell(slot, comboMetaMap, options = {}) {
  const slotInfo = parseSlot(slot);

  if (slotInfo.type === "break") {
    return "BREAK";
  }

  if (slotInfo.type === "empty") {
    return "";
  }

  return slotInfo.comboIds
    .map((comboId) => {
      const meta = comboMetaMap.get(comboId);
      if (!meta) {
        return `Assignment ${comboId.slice(-4)}`;
      }

      const teacherLine = meta.teacherNames.length ? meta.teacherNames.join(", ") : "";
      const classLine =
        options.includeClassNames === false || meta.classNames.length <= 1
          ? ""
          : `Combined: ${meta.classNames.join(", ")}`;

      return [meta.subjectName, teacherLine, classLine].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function parseSlot(slot) {
  if (slot === "BREAK") {
    return { type: "break", comboIds: [] };
  }

  if (slot === null || slot === undefined || slot === -1) {
    return { type: "empty", comboIds: [] };
  }

  if (Array.isArray(slot)) {
    const comboIds = slot
      .filter((value) => value && value !== -1 && value !== "BREAK")
      .map((value) => String(value));

    return {
      type: comboIds.length ? "filled" : "empty",
      comboIds,
    };
  }

  return { type: "filled", comboIds: [String(slot)] };
}

function getSlotComboIds(slot) {
  return parseSlot(slot).comboIds;
}

function getSubjectId(combo) {
  const value = combo?.subject?._id || combo?.subject_id || combo?.subject;
  return value ? String(value) : "";
}

function getFacultyIds(combo) {
  if (Array.isArray(combo?.faculty_ids)) {
    return combo.faculty_ids.map((facultyId) => String(facultyId));
  }
  if (combo?.faculty_id) {
    return [String(combo.faculty_id)];
  }
  if (combo?.faculty?._id || combo?.faculty) {
    return [String(combo?.faculty?._id || combo?.faculty)];
  }
  return [];
}

function getClassIds(combo) {
  if (Array.isArray(combo?.class_ids)) {
    return combo.class_ids.map((classId) => String(classId));
  }
  if (combo?.class_id) {
    return [String(combo.class_id)];
  }
  if (combo?.class?._id || combo?.class) {
    return [String(combo?.class?._id || combo?.class)];
  }
  return [];
}


function buildDayLabels(days) {
  return Array.from({ length: days }, (_, index) => DEFAULT_DAY_LABELS[index] || `Day ${index + 1}`);
}

function formatClassName(classDoc) {
  const name = classDoc?.name || classDoc?.id || "Unknown Class";
  const meta = [
    classDoc?.sem ? `Sem ${classDoc.sem}` : null,
    classDoc?.section || null,
  ]
    .filter(Boolean)
    .join(", ");

  return meta ? `${name} (${meta})` : name;
}

function makeSheetName(baseName, usedNames) {
  const sanitizedBase = String(baseName || "Sheet")
    .replace(/[:\\/?*\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31) || "Sheet";

  if (!usedNames.has(sanitizedBase)) {
    usedNames.add(sanitizedBase);
    return sanitizedBase;
  }

  let suffix = 2;
  while (suffix < 1000) {
    const candidate = `${sanitizedBase.slice(0, Math.max(0, 31 - String(suffix).length - 3))} (${suffix})`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    suffix += 1;
  }

  return `${Date.now()}`.slice(-31);
}

function styleWorksheet(sheet, totalColumns, options = {}) {
  const { table, comboMetaMap, hasFilters } = options;

  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  sheet.getRow(1).height = 22;
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  for (let columnIndex = 1; columnIndex <= totalColumns; columnIndex += 1) {
    const column = sheet.getColumn(columnIndex);
    column.width = columnIndex === 1 ? 20 : 26;
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.height = 38;
    }

    row.eachCell((cell, columnNumber) => {
      cell.alignment = {
        wrapText: true,
        vertical: "middle",
        horizontal: columnNumber === 1 ? "center" : "left",
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD5D5D5" } },
        left: { style: "thin", color: { argb: "FFD5D5D5" } },
        bottom: { style: "thin", color: { argb: "FFD5D5D5" } },
        right: { style: "thin", color: { argb: "FFD5D5D5" } },
      };

      if (rowNumber === 1) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF1F4E78" },
        };
      } else if (columnNumber === 1) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF3F6FA" },
        };
        cell.font = { bold: true };
      } else if (hasFilters && table && comboMetaMap) {
        // Now row-based (Day is Y-axis)
        const dayIndex = rowNumber - 2;
        const hourIndex = columnNumber - 2;
        const slot = table[dayIndex]?.[hourIndex];
        const comboIds = getSlotComboIds(slot);
        
        const isMatch = comboIds.some(cid => comboMetaMap.get(cid)?.matchesFilters);
        if (comboIds.length > 0 && !isMatch) {
          cell.font = { color: { argb: "FFAAAAAA" } };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF9F9F9" },
          };
        }
      }
    });
  });
}
