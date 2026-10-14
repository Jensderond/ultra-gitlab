-- SQLite seed data for integration testing with a real Tauri backend.
--
-- This file can be loaded into the app's SQLite database to provide
-- deterministic test data without depending on a live GitLab instance.
--
-- Usage:
--   sqlite3 ~/.local/share/com.jens.ultra-gitlab/ultra-gitlab.db < e2e/fixtures/seed.sql
--
-- NOTE: Tokens are NOT stored here. In CI, set the GITLAB_PAT environment
-- variable and use the setup_gitlab_instance command to authenticate.
-- This seed populates the cache tables only.

-- Clean existing test data
DELETE FROM comments WHERE mr_id >= 100 AND mr_id < 1000;
DELETE FROM diff_files WHERE mr_id >= 100 AND mr_id < 1000;
DELETE FROM diffs WHERE mr_id >= 100 AND mr_id < 1000;
DELETE FROM mr_reviewers WHERE mr_id >= 100 AND mr_id < 1000;
DELETE FROM merge_requests WHERE id >= 100 AND id < 1000;
DELETE FROM gitlab_instances WHERE id = 99;

-- Seed GitLab instance
INSERT OR REPLACE INTO gitlab_instances (id, url, name, token, created_at, authenticated_username)
VALUES (99, 'https://gitlab.example.com', 'Test Instance', '', strftime('%s', 'now'), 'testuser');

-- Seed merge requests
INSERT INTO merge_requests (id, instance_id, iid, project_id, project_name, title, description, author_username, source_branch, target_branch, state, web_url, created_at, updated_at, approval_status, approvals_required, approvals_count, labels, reviewers, cached_at, user_has_approved, head_pipeline_status)
VALUES
  (101, 99, 42, 10, 'frontend/web-app', 'feat: Add dark mode toggle to settings',
   'Implements a theme toggle in the settings panel.', 'alice',
   'feature/dark-mode', 'main', 'opened',
   'https://gitlab.example.com/frontend/web-app/-/merge_requests/42',
   strftime('%s', 'now', '-3 days'), strftime('%s', 'now', '-1 hour'),
   'pending', 2, 1, '["feature","frontend"]', '["bob","carol"]',
   strftime('%s', 'now'), 0, 'success'),

  (102, 99, 43, 10, 'frontend/web-app', 'fix: Resolve login redirect loop',
   'Fixes infinite redirect when session token expires.', 'bob',
   'fix/login-redirect', 'main', 'opened',
   'https://gitlab.example.com/frontend/web-app/-/merge_requests/43',
   strftime('%s', 'now', '-1 day'), strftime('%s', 'now', '-30 minutes'),
   'pending', 1, 0, '["bug","auth"]', '["alice"]',
   strftime('%s', 'now'), 0, 'success'),

  (103, 99, 44, 11, 'backend/api-service', 'refactor: Extract user service from controller',
   'Moves user business logic into a dedicated service layer.', 'carol',
   'refactor/user-service', 'develop', 'opened',
   'https://gitlab.example.com/backend/api-service/-/merge_requests/44',
   strftime('%s', 'now', '-5 days'), strftime('%s', 'now', '-2 hours'),
   'approved', 2, 2, '["refactor","backend"]', '["alice","dave"]',
   strftime('%s', 'now'), 0, 'success'),

  (104, 99, 45, 10, 'frontend/web-app', 'Draft: WIP dashboard redesign',
   'Work in progress on the new dashboard layout.', 'dave',
   'feature/dashboard-v2', 'main', 'opened',
   'https://gitlab.example.com/frontend/web-app/-/merge_requests/45',
   strftime('%s', 'now', '-7 days'), strftime('%s', 'now', '-1 day'),
   NULL, 2, 0, '["wip","frontend"]', '[]',
   strftime('%s', 'now'), 0, 'running');

-- Seed diffs
INSERT INTO diffs (mr_id, content, base_sha, head_sha, start_sha, file_count, additions, deletions, cached_at)
VALUES
  (101, '', 'abc123def456', 'fed654cba321', 'abc123def456', 3, 87, 8, strftime('%s', 'now'));

-- Seed diff files
INSERT INTO diff_files (mr_id, old_path, new_path, change_type, additions, deletions, file_position, diff_content)
VALUES
  (101, NULL, 'src/components/ThemeToggle.tsx', 'added', 45, 0, 0, NULL),
  (101, 'src/App.tsx', 'src/App.tsx', 'modified', 12, 3, 1,
   '@@ -1,5 +1,8 @@\n import React from "react";\n \n-function App() {\n+import { ThemeProvider } from "./ThemeProvider";\n+\n+function App() {\n   return (\n     <div className="app">'),
  (101, 'src/styles/theme.css', 'src/styles/theme.css', 'modified', 30, 5, 2, NULL);

-- Seed comments
INSERT INTO comments (id, mr_id, discussion_id, parent_id, author_username, body, file_path, old_line, new_line, line_type, resolved, resolvable, system, created_at, updated_at, cached_at, is_local)
VALUES
  (5001, 101, 'disc-001', NULL, 'bob',
   'Looks good overall! One small suggestion on the theme provider implementation.',
   NULL, NULL, NULL, NULL, 0, 1, 0,
   strftime('%s', 'now', '-2 hours'), strftime('%s', 'now', '-2 hours'),
   strftime('%s', 'now'), 0),

  (5002, 101, 'disc-002', NULL, 'carol',
   'Could we add a system preference detection here?',
   'src/components/ThemeToggle.tsx', NULL, 15, 'new', 0, 1, 0,
   strftime('%s', 'now', '-1 hour'), strftime('%s', 'now', '-1 hour'),
   strftime('%s', 'now'), 0);

-- Seed reviewers
INSERT INTO mr_reviewers (mr_id, username, status, cached_at)
VALUES
  (101, 'bob', 'approved', strftime('%s', 'now')),
  (101, 'carol', 'pending', strftime('%s', 'now'));
