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
      <h2>2. Core Data (The Foundation)</h2>
      <p>These are the pieces needed to build a timetable. Add them first.</p>
      <ul>
        <li><strong>Faculties (Teachers):</strong> Add each teacher on the <a href="/faculties">Faculties</a> page.</li>
        <li><strong>Subjects:</strong> Add every subject on the <a href="/subjects">Subjects</a> page.</li>
        <li><strong>Classes:</strong> Create class student groups (e.g. CSE 3-A) on the <a href="/classes">Classes</a> page.</li>
      </ul>
    </section>

    <section className="guide-section">
      <h2>3. Teaching Allocations (Two Methods)</h2>
      <p>Tell the system who teaches what. You can choose the method that fits your college best.</p>
      
      <h3>Method A: Direct Entry (Recommended for Small Colleges)</h3>
      <ul>
        <li>Go directly to <a href="/teaching-allocations">Manage Allocations</a>.</li>
        <li>Pick a Class + Subject + Teacher and enter the weekly hours.</li>
        <li>This is fast and gives you total control.</li>
      </ul>

      <h3>Method B: Mapping-Based (Recommended for Large Colleges)</h3>
      <ul>
        <li>Step 1: Link Subjects to Classes on the <a href="/class-subjects">Class-Subjects</a> page.</li>
        <li>Step 2: Define which teachers teach which subjects on the <a href="/teacher-subject-combos">Teacher-Subjects</a> page.</li>
        <li>Step 3: Link teachers to classes on the <a href="/class-faculties">Class-Faculties</a> page.</li>
        <li>Step 4: Go to <a href="/teaching-allocations">Manage Allocations</a> and click <strong>"Sync from Mappings (Bulk)"</strong>.</li>
        <li>The system will automatically intersect your mappings to create assignments.</li>
      </ul>
    </section>

    <section className="guide-section">
      <h2>4. Timetable Generation</h2>
      <p>After data and teaching allocations are ready:</p>
      <ul>
        <li>Go to the <a href="/timetable">Timetable</a> page.</li>
        <li><strong>Pre-Generation Audit:</strong> Review the health report to catch data errors early.</li>
        <li>Use <strong>Fix Slots</strong> to lock specific subjects to a time (e.g. morning labs).</li>
        <li>Click <strong>Generate</strong> to find a valid schedule.</li>
      </ul>
    </section>

    <section className="guide-section">
      <h2>5. Common Tasks</h2>
      <ul>
        <li><strong>Manage Availability:</strong> Block time for teachers on the <a href="/teacher-availability">Availability</a> page.</li>
        <li><strong>Set Preferences:</strong> Define "Avoid First Period" etc. on the <a href="/teacher-preferences">Preferences</a> page.</li>
        <li><strong>Download/Export:</strong> Use the export buttons on the Timetable page for Excel or PDF versions.</li>
      </ul>
    </section>

    <section className="guide-section">
      <h2>6. Troubleshooting & Support</h2>
      <ul>
        <li><strong>Generation is slow:</strong> Try reducing constraints or increasing solver time in settings.</li>
        <li><strong>Infeasible results:</strong> Check the Audit report. Usually, a teacher is assigned too many hours.</li>
        <li><strong>Need help?</strong> See DEPLOYMENT.md in the project root.</li>
      </ul>
    </section>

    <footer style={{marginTop:20}}>
      <small>Quick tip: follow the numbered sections in order for the smoothest experience.</small>
    </footer>
  </div>
);

export default HomePage;
