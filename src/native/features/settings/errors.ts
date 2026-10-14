/** Human-readable messages for backend errors around connecting to GitLab. */

import { ApiError } from '../../api/client';

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url || 'the server';
  }
}

export function describeError(err: unknown, instanceUrl = ''): string {
  const code = err instanceof ApiError ? err.code : '';
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const where = host(instanceUrl);

  if (
    code === 'Authentication' ||
    code === 'AuthenticationExpired' ||
    /\b401\b|unauthori[sz]ed|invalid token|token (is )?(expired|revoked)/.test(lower)
  ) {
    return `${where} didn't accept this token. Check that it's active and has the "api" scope.`;
  }
  if (/\b403\b|forbidden|insufficient_scope/.test(lower)) {
    return `This token can't read your account. Give it the "api" and "read_user" scopes.`;
  }
  if (/\b404\b|not found/.test(lower) && code !== 'NotFound') {
    return `${where} answered, but it doesn't look like a GitLab server. Check the URL.`;
  }
  if (
    code === 'Network' ||
    /dns|resolve|connect|timed? ?out|unreachable|certificate|tls|ssl|network|error sending request/.test(lower)
  ) {
    return `Couldn't reach ${where}. Check the URL and your network connection.`;
  }
  if (code === 'InvalidInput') return message;
  return message || 'Something went wrong. Try again.';
}
