/**
 * Open a GitLab merge request / pipeline URL inside the app. Used by the
 * search field (paste a URL, press ↩) and by `ultra-gitlab://` deep links.
 */

import { api, invoke } from '../../api/client';
import { getData, invalidate } from '../../data/query';
import { setActiveInstanceId } from '../../data/hooks';
import { navigate, paths } from '../../app/router';
import { toast } from '../../ui/components';
import type { InstanceWithStatus } from '../../api/client';
import type { GitLabLink } from './rank';

async function instanceFor(link: GitLabLink): Promise<InstanceWithStatus | null> {
  const instances = getData<InstanceWithStatus[]>(['instances']) ?? (await api.instances());
  return (
    instances.find((i) => {
      try {
        return new URL(i.url).host === link.host;
      } catch {
        return false;
      }
    }) ?? null
  );
}

/** Resolve and navigate. Resolves to false (after telling the user why) when it can't. */
export async function openGitLabLink(link: GitLabLink): Promise<boolean> {
  const instance = await instanceFor(link);
  if (!instance) {
    toast(`${link.host} isn't one of your GitLab instances`, {
      tone: 'error',
      action: { label: 'Add…', run: () => navigate(paths.setup()) },
    });
    return false;
  }
  try {
    if (link.kind === 'mr') {
      // Cached locally? Open instantly; otherwise fetch it from GitLab first.
      const resolved = (await api.resolveMrByUrl(link.webUrl)) ?? (await api.fetchMrByUrl(link.webUrl));
      setActiveInstanceId(instance.id);
      void invalidate(['mrs']);
      navigate(paths.review(resolved.localId));
      return true;
    }
    const project = await invoke<{ id: number; nameWithNamespace: string }>('resolve_project_by_path', {
      instanceId: instance.id,
      projectPath: link.projectPath,
    });
    setActiveInstanceId(instance.id);
    navigate(paths.pipeline(instance.id, project.id, link.pipelineId));
    return true;
  } catch (e) {
    const what = link.kind === 'mr' ? `!${link.iid}` : `pipeline #${link.pipelineId}`;
    toast(`Couldn't open ${what} in ${link.projectPath}: ${(e as Error).message}`, { tone: 'error' });
    return false;
  }
}
