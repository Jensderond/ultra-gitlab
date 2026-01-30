/**
 * Main application component with routing.
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Settings from './pages/Settings';
import MRListPage from './pages/MRListPage';
import MRDetailPage from './pages/MRDetailPage';
import './App.css';

/**
 * Main application component.
 *
 * Provides routing for:
 * - / - Redirect to /mrs
 * - /mrs - List of merge requests
 * - /mrs/:id - Merge request detail/diff view
 * - /settings - Settings and GitLab instance management
 */
function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          {/* Redirect root to MR list */}
          <Route path="/" element={<Navigate to="/mrs" replace />} />

          {/* MR list page */}
          <Route path="/mrs" element={<MRListPage />} />

          {/* MR detail page */}
          <Route path="/mrs/:id" element={<MRDetailPage />} />

          {/* Settings page */}
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
