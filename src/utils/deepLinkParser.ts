export interface MrDeepLinkData {
  type: 'mr';
  instanceHost: string;
  projectPath: string;
  mrIid: number;
  webUrl: string;
}

export interface PipelineDeepLinkData {
  type: 'pipeline';
  instanceHost: string;
  projectPath: string;
  pipelineId: number;
  webUrl: string;
}

export type DeepLinkData = MrDeepLinkData | PipelineDeepLinkData;

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
    const pathStr = gitlabUrl.pathname;

    // Try MR URL: /group/project/-/merge_requests/123
    const mrDelimiter = '/-/merge_requests/';
    const mrIndex = pathStr.indexOf(mrDelimiter);
    if (mrIndex !== -1) {
      const projectPath = pathStr.substring(1, mrIndex);
      const mrIidStr = pathStr.substring(mrIndex + mrDelimiter.length).replace(/\/+$/, '');
      const mrIid = parseInt(mrIidStr, 10);

      if (!projectPath || isNaN(mrIid) || mrIid <= 0) return null;
      return { type: 'mr', instanceHost, projectPath, mrIid, webUrl };
    }

    // Try pipeline URL: /group/project/-/pipelines/309881
    const pipelineDelimiter = '/-/pipelines/';
    const pipelineIndex = pathStr.indexOf(pipelineDelimiter);
    if (pipelineIndex !== -1) {
      const projectPath = pathStr.substring(1, pipelineIndex);
      const pipelineIdStr = pathStr.substring(pipelineIndex + pipelineDelimiter.length).replace(/\/+$/, '');
      const pipelineId = parseInt(pipelineIdStr, 10);

      if (!projectPath || isNaN(pipelineId) || pipelineId <= 0) return null;
      return { type: 'pipeline', instanceHost, projectPath, pipelineId, webUrl };
    }

    return null;
  } catch {
    return null;
  }
}
