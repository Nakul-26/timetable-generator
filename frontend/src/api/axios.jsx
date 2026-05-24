import axios from 'axios';

const API = axios.create({ 
    baseURL: import.meta.env.VITE_BACKEND_URL, 
    withCredentials: true 
});

// Attach selected college id (if set) so superadmin can act within a college context.
API.interceptors.request.use((config) => {
  try {
    if (typeof window !== "undefined") {
      const selected = window.localStorage.getItem("selectedCollegeId");
      if (selected) {
        config.headers = config.headers || {};
        config.headers["x-college-id"] = selected;
      }
    }
  } catch {
    // ignore localStorage errors
  }
  return config;
});

API.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }
    return Promise.reject(error);
  }
);

export default API;
