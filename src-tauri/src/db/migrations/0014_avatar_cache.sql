-- Add session_cookie to gitlab_instances for avatar downloads
ALTER TABLE gitlab_instances ADD COLUMN session_cookie TEXT;

-- Create user_avatars table for cached avatar images
CREATE TABLE IF NOT EXISTS user_avatars (
    instance_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    avatar_url TEXT,
    avatar_data BLOB,
    content_type TEXT,
    fetched_at INTEGER,
    PRIMARY KEY (instance_id, username),
    FOREIGN KEY (instance_id) REFERENCES gitlab_instances(id) ON DELETE CASCADE
);
