import { Router } from 'express';
import auth from '../middleware/auth.js';
import requireCollegeContext from '../middleware/collegeScope.js';

import authRoutes from './api/auth.js';
import superAdminRoutes from './api/superadmin.js';
import facultyRoutes from './api/faculty.js';
import subjectRoutes from './api/subject.js';
import classRoutes from './api/class.js';
import teacherSubjectRoutes from './api/teacherSubject.js';
import classSubjectRoutes from './api/classSubject.js';
import timetableRoutes from './api/timetable.js';
import teachingAllocationRoutes from './api/teachingAllocation.js';

const router = Router();
const protectedRouter = Router();
protectedRouter.use(auth);
protectedRouter.use(requireCollegeContext);

// unprotected routes
router.use(authRoutes);

// superadmin routes need auth but must NOT be wrapped by tenant scope middleware
// mount them directly on the top-level router so they are not blocked by requireCollegeContext
router.use(superAdminRoutes);
protectedRouter.use(facultyRoutes);
protectedRouter.use(subjectRoutes);
protectedRouter.use(classRoutes);
protectedRouter.use(teacherSubjectRoutes);
protectedRouter.use(classSubjectRoutes);
protectedRouter.use(teachingAllocationRoutes);
protectedRouter.use(timetableRoutes);

router.use(protectedRouter);

export default router;
