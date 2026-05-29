import React, { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import "../styles/Navbar.css";
import { useAuth } from "../context/AuthContext";
import API from "../api/axios";

const Navbar = () => {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isSuper = user?.role === 'superadmin';
  const [colleges, setColleges] = useState([]);
  const [selectedCollege, setSelectedCollege] = useState(
    typeof window !== 'undefined' ? window.localStorage.getItem('selectedCollegeId') || '' : ''
  );
  const showTenantLinks = !isSuper || (isSuper && selectedCollege);

  useEffect(() => {
    if (!isSuper) return;
    let mounted = true;
    (async () => {
      try {
        const res = await API.get('/superadmin/colleges');
        const list = res?.data?.colleges || res?.data || [];
        if (mounted && Array.isArray(list)) {
          setColleges(list);
          // If superadmin and only one college exists, auto-select it to reveal tenant links
          try {
            const existing = typeof window !== 'undefined' ? window.localStorage.getItem('selectedCollegeId') || '' : '';
            if (!existing && list.length === 1) {
              const cid = list[0].collegeId || list[0]._id || '';
              if (cid) {
                if (typeof window !== 'undefined') window.localStorage.setItem('selectedCollegeId', cid);
                setSelectedCollege(cid);
                window.location.reload();
              }
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore — selector can stay empty
      }
    })();
    return () => { mounted = false; };
  }, [isSuper]);

  const handleLogout = async () => {
    await logout();
    setIsMenuOpen(false);
    navigate("/login", { replace: true });
  };

  if (loading || !user) {
    return null;
  }

  return (
    <nav className="navbar">
      <div className="navbar-logo">TimeTable Generator</div>
      <button
        type="button"
        className="nav-menu-toggle"
        aria-label="Toggle navigation menu"
        aria-expanded={isMenuOpen}
        onClick={() => setIsMenuOpen((prev) => !prev)}
      >
        {isMenuOpen ? "Close" : "Menu"}
      </button>
      <div className={`navbar-links ${isMenuOpen ? "open" : ""}`}>
        {showTenantLinks && (
          <>
            <NavLink to="/home" className="nav-item" onClick={() => setIsMenuOpen(false)}>Home</NavLink>
            <NavLink to="/faculties" className="nav-item" onClick={() => setIsMenuOpen(false)}>Faculties</NavLink>
            <NavLink to="/subjects" className="nav-item" onClick={() => setIsMenuOpen(false)}>Subjects</NavLink>
            <NavLink to="/classes" className="nav-item" onClick={() => setIsMenuOpen(false)}>Classes</NavLink>
            
            {/* <div className="nav-section-label">Allocations</div> */}
            <NavLink to="/teaching-allocations" className="nav-item" onClick={() => setIsMenuOpen(false)}>Manage Allocations</NavLink>
            
            {/* <div className="nav-section-label">Mappings (Bulk)</div> */}
            <NavLink to="/class-subjects" className="nav-item" onClick={() => setIsMenuOpen(false)}>Class-Subjects</NavLink>
            <NavLink to="/teacher-subject-combos" className="nav-item" onClick={() => setIsMenuOpen(false)}>Teacher-Subjects</NavLink>
            <NavLink to="/class-faculties" className="nav-item" onClick={() => setIsMenuOpen(false)}>Class-Faculties</NavLink>
            <NavLink to="/class-elective-subjects" className="nav-item" onClick={() => setIsMenuOpen(false)}>Elective Mappings</NavLink>

            {/* <div className="nav-section-label">Constraints</div> */}
            <NavLink to="/teacher-availability" className="nav-item" onClick={() => setIsMenuOpen(false)}>Availability</NavLink>
            <NavLink to="/teacher-preferences" className="nav-item" onClick={() => setIsMenuOpen(false)}>Preferences</NavLink>
            
            {/* <div className="nav-section-label">Generation</div> */}
            <NavLink to="/timetable" className="nav-item" onClick={() => setIsMenuOpen(false)}>Generate Timetable</NavLink>
            <NavLink to="/saved-timetables" className="nav-item" onClick={() => setIsMenuOpen(false)}>History</NavLink>
            <NavLink to="/support" className="nav-item" onClick={() => setIsMenuOpen(false)}>Support</NavLink>
          </>
        )}
        {isSuper && (
          <>
            <NavLink to="/superadmin" className="nav-item" onClick={() => setIsMenuOpen(false)}>Superadmin</NavLink>
            <NavLink to="/superadmin/colleges" className="nav-item" onClick={() => setIsMenuOpen(false)}>Manage Colleges</NavLink>
            <NavLink to="/superadmin/admins" className="nav-item" onClick={() => setIsMenuOpen(false)}>Manage Admins</NavLink>
            <NavLink to="/superadmin/create-college" className="nav-item" onClick={() => setIsMenuOpen(false)}>Create College</NavLink>
            <NavLink to="/superadmin/create-admin" className="nav-item" onClick={() => setIsMenuOpen(false)}>Create Admin</NavLink>
            <div className="nav-item" style={{ marginLeft: 8 }}>
              <label style={{ marginRight: 6, fontSize: 12 }}>Act as:</label>
              <select
                className="act-as-select"
                value={selectedCollege || ""}
                onChange={(e) => {
                  const val = e.target.value || '';
                  try {
                    if (val) window.localStorage.setItem('selectedCollegeId', val);
                    else window.localStorage.removeItem('selectedCollegeId');
                  } catch {
                    // ignore
                  }
                  setSelectedCollege(val);
                  // reload so pages refetch under new context
                  window.location.reload();
                }}
              >
                <option value="">-- Select college --</option>
                {colleges.map((c) => (
                  <option key={c._id || c.collegeId} value={c.collegeId || c._id}>{c.name || c.collegeName || c.name}</option>
                ))}
              </select>
            </div>
          </>
        )}
        
        <button onClick={handleLogout} className="nav-item-logout">
          Logout
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
