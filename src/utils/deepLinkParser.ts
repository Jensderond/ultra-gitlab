export interface DeepLinkData {
  instanceHost: string;
  projectPath: string;
  mrIid: number;
  webUrl: string;
}

export function parseDeepLinkUrl(deepLinkUrl: string): DeepLinkData | null {
  try {
    const parsed = new URL(deepLinkUrl);

    if (parsed.protocol !== 'ultra-gitlab:' || parsed.hostname !== 'open') {
      return null;
    }

    const encodedUrl = parsed.searchParams.get('url');
    if (!encodedUrl) {
      return null;
    }

    const webUrl = encodedUrl.replace(/\/+$/, '');

    const gitlabUrl = new URL(webUrl);
    const instanceHost = gitlabUrl.host;

    const mrDelimiter = '/-/merge_requests/';
    const pathStr = gitlabUrl.pathname;
    const delimiterIndex = pathStr.indexOf(mrDelimiter);

    if (delimiterIndex === -1) {
      return null;
    }

    const projectPath = pathStr.substring(1, delimiterIndex);
    const afterDelimiter = pathStr.substring(delimiterIndex + mrDelimiter.length);
    const mrIidStr = afterDelimiter.replace(/\/+$/, '');
    const mrIid = parseInt(mrIidStr, 10);

    if (!projectPath || isNaN(mrIid) || mrIid <= 0) {
      return null;
    }

    return { instanceHost, projectPath, mrIid, webUrl };
  } catch {
    return null;
  }
}
