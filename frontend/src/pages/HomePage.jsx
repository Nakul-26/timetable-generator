import React from 'react';
import './HomePage.css';

const HomePage = () => (
  <div className="home-container">
    <h1>Timetable Generator — Quick Guide</h1>

    <p>This page explains every feature in simple words and shows how to use the site step-by-step.</p>

    <section className="guide-section">
      <h2>1. Before You Start</h2>
      <ul>
        <li>Make sure you are logged in. Use the login page to sign in.</li>
        <li>If you are a superadmin, pick a college from the "Act as" selector in the top bar.</li>
        <li>Work through this guide in order: add core data, assign teachers, then generate.</li>
      </ul>
    </section>

    <section className="guide-section">
      <h2>2. Core Data (What to add)</h2>
      <p>These are the pieces needed to build a timetable. Add them first.</p>
      <ul>
        <li><strong>Faculties (Teachers):</strong> Add each teacher with their name and subjects they can teach. Find this under the <a href="/faculties">Faculties</a> page.</li>
        <li><strong>Subjects:</strong> Add every subject offered by the college on the <a href="/subjects">Subjects</a> page.</li>
        <li><strong>Classes (Student groups):</strong> Create class records (course, year, section) on the <a href="/classes">Classes</a> page.</li>
        <li><strong>Teacher-Subject Combos:</strong> For each teacher, link the subjects they can teach. This ensures assignments choose only valid teacher-subject pairs.</li>
      </ul>
    </section>

    <section className="guide-section">
      <h2>3. Assignments (Who teaches what)</h2>
      <p>Tell the system which subject is taught to which class and by which teacher.</p>
      <ol>
        <li>Open the <a href="/class-subjects">Class-Subjects</a> page to assign subjects to classes.</li>
        <li>Use <a href="/class-faculties">Class-Faculties</a> or the Assignments button on a class to choose teachers for each subject.</li>
        <li>For elective subjects, use the <a href="/class-elective-subjects">Elective Subjects</a> page to create groups and options.</li>
      </ol>
      <p>Tip: keep data complete — missing teacher links or subject hours will reduce generator quality.</p>
    </section>

    <section className="guide-section">
      <h2>4. Timetable Generation</h2>
      <p>After data and assignments are ready:</p>
      <ul>
        <li>Go to the <a href="/timetable">Timetable</a> page.</li>
        <li>Choose the class or full-generation options if available.</li>
        <li>Use <strong>Fix Slots</strong> to lock a subject to a particular day/time before generating.</li>
        <li>Click <strong>Generate</strong>. The server runs the generator and returns a result you can view and save.</li>
      </ul>
      <p>If you don’t like the result, use <strong>Regenerate</strong> to try another solution.</p>
    </section>

    <section className="guide-section">
      <h2>5. Superadmin Features</h2>
      <ul>
        <li><strong>Manage Colleges:</strong> Superadmins can create, edit, and delete colleges under the Superadmin menu.</li>
        <li><strong>Manage Admins:</strong> Create or remove admin users and assign them to colleges.</li>
        <li><strong>Act as college:</strong> Use the top-bar selector to pick a college. The frontend will add the college id to requests so you can work as that college.</li>
      </ul>
    </section>

    <section className="guide-section">
      <h2>6. Exports and Reports</h2>
      <p>Export generated timetables or download reports:</p>
      <ul>
        <li>On the timetable view, use Export to download schedules in supported formats (CSV/Excel/PDF depending on configuration).</li>
        <li>Save results to reference them later or to share with staff.</li>
      </ul>
    </section>

    <section className="guide-section">
      <h2>7. Common Tasks — Short How-tos</h2>
      <ul>
        <li><strong>Add a teacher:</strong> Open <a href="/faculties">Faculties</a> → Add → fill details → save.</li>
        <li><strong>Link a teacher to a subject:</strong> In the teacher's edit screen, add the subject under Teacher-Subject Combos.</li>
        <li><strong>Create a class and assign subjects:</strong> Classes → Create class → go to Assignments → add subjects and teachers.</li>
        <li><strong>Regenerate timetable:</strong> Timetable → select scope → click Generate → review result.</li>
      </ul>
    </section>

    <section className="guide-section">
      <h2>8. Troubleshooting & Tips</h2>
      <ul>
        <li>If a page is empty, check the selected college (top-bar) and your login permissions.</li>
        <li>If generation fails or results are poor: verify subject hours, teacher availability, and that teachers are linked to subjects.</li>
        <li>Use small, incremental changes — add data then generate for a single class first to validate settings.</li>
        <li>Contact your system admin if you see permission errors (403) or missing data.</li>
      </ul>
    </section>

    <section className="guide-section">
      <h2>9. Where to find help</h2>
      <p>Found a bug or need a new feature? Share details with screenshots and steps to reproduce. For deployment help, see DEPLOYMENT.md in the project root.</p>
    </section>

    <footer style={{marginTop:20}}>
      <small>Quick tip: follow the numbered sections in order for the smoothest experience.</small>
    </footer>
  </div>
);

export default HomePage;
