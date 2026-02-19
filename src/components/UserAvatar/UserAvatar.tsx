/**
 * UserAvatar — shows a cached GitLab avatar image or falls back to an initial letter.
 *
 * Uses an in-memory Map cache to avoid redundant IPC per render cycle.
 */

import { useEffect, useState } from 'react';
import { getAvatar } from '../../services';
import './UserAvatar.css';

/** In-memory cache: `${instanceId}:${username}` → data URI (or empty string for "no avatar"). */
const avatarCache = new Map<string, string>();

interface UserAvatarProps {
  instanceId: number;
  username: string;
  size?: number;
  className?: string;
}

export default function UserAvatar({ instanceId, username, size = 20, className = '' }: UserAvatarProps) {
  const cacheKey = `${instanceId}:${username}`;
  const cached = avatarCache.get(cacheKey);
  const [dataUri, setDataUri] = useState<string | undefined>(cached);

  useEffect(() => {
    // If we already have a definitive answer (loaded or known-empty), skip IPC
    if (avatarCache.has(cacheKey)) return;

    let cancelled = false;
    getAvatar(instanceId, username).then((uri) => {
      if (cancelled) return;
      const value = uri ?? '';
      avatarCache.set(cacheKey, value);
      setDataUri(value);
    }).catch(() => {
      // IPC failure — fall back to initial
      if (!cancelled) {
        avatarCache.set(cacheKey, '');
        setDataUri('');
      }
    });

    return () => { cancelled = true; };
  }, [cacheKey, instanceId, username]);

  const style = { width: size, height: size, fontSize: size * 0.5 };

  if (dataUri) {
    return (
      <img
        className={`user-avatar ${className}`}
        src={dataUri}
        alt={username}
        style={style}
      />
    );
  }

  return (
    <span className={`user-avatar user-avatar-initial ${className}`} style={style}>
      {username.charAt(0).toUpperCase()}
    </span>
  );
}

/** Clear the in-memory avatar cache (e.g. after a cookie-triggered refresh). */
export function clearAvatarCache() {
  avatarCache.clear();
}
