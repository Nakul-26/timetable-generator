import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import "../styles/Navbar.css";
import { useAuth } from "../context/AuthContext";

const Navbar = () => {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isSuper = user?.role === 'superadmin';

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
        {!isSuper && (
          <>
            <NavLink to="/" className="nav-item" onClick={() => setIsMenuOpen(false)}>Home</NavLink>
            <NavLink to="/faculties" className="nav-item" onClick={() => setIsMenuOpen(false)}>Faculties</NavLink>
            <NavLink to="/subjects" className="nav-item" onClick={() => setIsMenuOpen(false)}>Subjects</NavLink>
            <NavLink to="/classes" className="nav-item" onClick={() => setIsMenuOpen(false)}>Classes</NavLink>
            <NavLink to="/class-subjects" className="nav-item" onClick={() => setIsMenuOpen(false)}>Class Subjects</NavLink>
            <NavLink to="/class-faculties" className="nav-item" onClick={() => setIsMenuOpen(false)}>Class Faculties</NavLink>
            <NavLink to="/teaching-allocations" className="nav-item" onClick={() => setIsMenuOpen(false)}>Class - Subject - Teacher</NavLink>
            <NavLink to="/class-elective-subjects" className="nav-item" onClick={() => setIsMenuOpen(false)}>Elective Subjects</NavLink>
            <NavLink to="/teacher-subject-combos" className="nav-item" onClick={() => setIsMenuOpen(false)}>Teacher Subjects</NavLink>
            <NavLink to="/teacher-availability" className="nav-item" onClick={() => setIsMenuOpen(false)}>Teacher Availability</NavLink>
            <NavLink to="/teacher-preferences" className="nav-item" onClick={() => setIsMenuOpen(false)}>Teacher Preferences</NavLink>
            <NavLink to="/timetable" className="nav-item" onClick={() => setIsMenuOpen(false)}>Timetable</NavLink>
            <NavLink to="/timetable/settings" className="nav-item" onClick={() => setIsMenuOpen(false)}>Timetable Settings</NavLink>
            <NavLink to="/saved-timetables" className="nav-item" onClick={() => setIsMenuOpen(false)}>Generated Timetables</NavLink>
          </>
        )}
        {isSuper && (
          <NavLink to="/superadmin" className="nav-item" onClick={() => setIsMenuOpen(false)}>Superadmin</NavLink>
        )}
        <button onClick={handleLogout} className="nav-item-logout">
          Logout
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
