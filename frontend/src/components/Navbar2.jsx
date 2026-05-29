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
        // ignore
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
      <div className="navbar-logo" onClick={() => navigate("/")}>
        TimeTable Gen
      </div>
      <button 
        className="nav-menu-toggle" 
        onClick={() => setIsMenuOpen(!isMenuOpen)}
      >
        {isMenuOpen ? "✕" : "☰"}
      </button>

      <div className={`navbar-links ${isMenuOpen ? "open" : ""}`}>
        {showTenantLinks && (
          <>
            <NavLink to="/home" className="nav-item" onClick={() => setIsMenuOpen(false)}>Home</NavLink>
            <NavLink to="/faculties" className="nav-item" onClick={() => setIsMenuOpen(false)}>Faculties</NavLink>
            <NavLink to="/subjects" className="nav-item" onClick={() => setIsMenuOpen(false)}>Subjects</NavLink>
            <NavLink to="/classes" className="nav-item" onClick={() => setIsMenuOpen(false)}>Classes</NavLink>
            
            <NavLink to="/teaching-allocations" className="nav-item" onClick={() => setIsMenuOpen(false)}>Allocations</NavLink>
            <NavLink to="/class-subjects" className="nav-item" onClick={() => setIsMenuOpen(false)}>Class-Subjects</NavLink>
            <NavLink to="/teacher-subject-combos" className="nav-item" onClick={() => setIsMenuOpen(false)}>Teacher-Subjects</NavLink>
            <NavLink to="/class-faculties" className="nav-item" onClick={() => setIsMenuOpen(false)}>Class-Faculties</NavLink>
            <NavLink to="/class-elective-subjects" className="nav-item" onClick={() => setIsMenuOpen(false)}>Electives</NavLink>
            
            <NavLink to="/teacher-availability" className="nav-item" onClick={() => setIsMenuOpen(false)}>Availability</NavLink>
            <NavLink to="/teacher-preferences" className="nav-item" onClick={() => setIsMenuOpen(false)}>Preferences</NavLink>
            
            <NavLink to="/timetable" className="nav-item" onClick={() => setIsMenuOpen(false)}>Generate</NavLink>
            <NavLink to="/saved-timetables" className="nav-item" onClick={() => setIsMenuOpen(false)}>History</NavLink>
            <NavLink to="/support" className="nav-item" onClick={() => setIsMenuOpen(false)}>Support</NavLink>
          </>
        )}
        
        {isSuper && (
          <>
            <NavLink to="/superadmin" className="nav-item" onClick={() => setIsMenuOpen(false)}>Superadmin</NavLink>
            <div className="nav-item">
              <label>Act as:</label>
              <select 
                className="act-as-select"
                value={selectedCollege || ""} 
                onChange={(e) => {
                  const val = e.target.value || '';
                  try {
                    if (val) window.localStorage.setItem('selectedCollegeId', val);
                    else window.localStorage.removeItem('selectedCollegeId');
                  } catch { /* ignore */ }
                  setSelectedCollege(val);
                  window.location.reload();
                }}
              >
                <option value="">-- Select college --</option>
                {colleges.map((c) => (
                  <option key={c._id || c.collegeId} value={c.collegeId || c._id}>
                    {c.name || c.collegeName}
                  </option>
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
