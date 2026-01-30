/**
 * Main application component with routing.
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Settings from './pages/Settings';
import MRListPage from './pages/MRListPage';
import './App.css';

/**
 * Placeholder component for MR detail page.
 * Will be implemented in T052 (User Story 1).
 */
function MRDetailPage() {
  return (
    <div className="page">
      <h1>Merge Request Detail</h1>
      <p>Diff viewer will be displayed here.</p>
    </div>
  );
}

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
