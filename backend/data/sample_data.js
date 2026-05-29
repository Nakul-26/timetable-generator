// backend/sample_data.js

export const sampleData = {
  "classes": [
    {
      "_id": "C1",
      "id": "C1",
      "name": "Class A",
      "sem": "1",
      "section": "A",
      "days_per_week": 6
    },
    {
      "_id": "C2",
      "id": "C2",
      "name": "Class B",
      "sem": "1",
      "section": "B",
      "days_per_week": 6
    }
  ],
  "subjects": [
    {
      "_id": "S1",
      "id": "S1",
      "name": "Math",
      "sem": "1",
      "type": "theory"
    },
    {
      "_id": "S2",
      "id": "S2",
      "name": "Science",
      "sem": "1",
      "type": "theory"
    },
    {
      "_id": "S3",
      "id": "S3",
      "name": "History",
      "sem": "1",
      "type": "theory"
    },
    {
      "_id": "S4",
      "id": "S4",
      "name": "Lab",
      "sem": "1",
      "type": "lab"
    }
  ],
  "teachers": [
    {
      "_id": "T1",
      "id": "T1",
      "name": "Mr. Smith"
    },
    {
      "_id": "T2",
      "id": "T2",
      "name": "Mrs. Jones"
    },
    {
      "_id": "T3",
      "id": "T3",
      "name": "Mr. Williams"
    }
  ],
  "classSubjects": [
    {
      "classId": "C1",
      "subjectId": "S1",
      "hoursPerWeek": 4
    },
    {
      "classId": "C1",
      "subjectId": "S2",
      "hoursPerWeek": 4
    },
    {
      "classId": "C1",
      "subjectId": "S3",
      "hoursPerWeek": 3
    },
    {
      "classId": "C1",
      "subjectId": "S4",
      "hoursPerWeek": 2
    },
    {
      "classId": "C2",
      "subjectId": "S1",
      "hoursPerWeek": 4
    },
    {
      "classId": "C2",
      "subjectId": "S2",
      "hoursPerWeek": 4
    },
    {
      "classId": "C2",
      "subjectId": "S3",
      "hoursPerWeek": 3
    }
  ],
  "classTeachers": [
    {
      "classId": "C1",
      "teacherId": "T1"
    },
    {
      "classId": "C1",
      "teacherId": "T2"
    },
    {
      "classId": "C2",
      "teacherId": "T1"
    },
    {
      "classId": "C2",
      "teacherId": "T3"
    }
  ],
  "teacherSubjectCombos": [
    {
      "teacherId": "T1",
      "subjectId": "S1"
    },
    {
      "teacherId": "T1",
      "subjectId": "S2"
    },
    {
      "teacherId": "T2",
      "subjectId": "S2"
    },
    {
      "teacherId": "T2",
      "subjectId": "S3"
    },
    {
      "teacherId": "T3",
      "subjectId": "S1"
    },
    {
        "teacherId": "T3",
        "subjectId": "S4"
    }
  ]
}
