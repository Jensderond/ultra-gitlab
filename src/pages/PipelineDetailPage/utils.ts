import type { PipelineJob, PipelineJobStatus } from '../../types';

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export function formatRelativeTime(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(isoString).toLocaleDateString();
}

export function jobStatusLabel(status: PipelineJobStatus): string {
  switch (status) {
    case 'success': return 'passed';
    case 'failed': return 'failed';
    case 'running': return 'running';
    case 'pending': return 'pending';
    case 'canceled': return 'canceled';
    case 'skipped': return 'skipped';
    case 'manual': return 'manual';
    case 'created': return 'created';
    case 'waiting_for_resource': return 'waiting';
    case 'preparing': return 'preparing';
    case 'scheduled': return 'scheduled';
  }
}

export interface StageGroup {
  name: string;
  jobs: PipelineJob[];
  status: PipelineJobStatus;
}

export function aggregateStageStatus(jobs: PipelineJob[]): PipelineJobStatus {
  if (jobs.some((j) => j.status === 'running')) return 'running';
  if (jobs.some((j) => j.status === 'pending')) return 'pending';
  if (jobs.some((j) => j.status === 'preparing')) return 'preparing';
  if (jobs.some((j) => j.status === 'waiting_for_resource')) return 'waiting_for_resource';
  if (jobs.some((j) => j.status === 'failed' && !j.allowFailure)) return 'failed';
  if (jobs.some((j) => j.status === 'canceled')) return 'canceled';
  if (jobs.some((j) => j.status === 'manual')) return 'manual';
  if (jobs.some((j) => j.status === 'scheduled')) return 'scheduled';
  if (jobs.some((j) => j.status === 'created')) return 'created';
  if (jobs.every((j) => j.status === 'skipped')) return 'skipped';
  if (jobs.every((j) => j.status === 'success' || (j.status === 'failed' && j.allowFailure) || j.status === 'skipped'))
    return 'success';
  return 'created';
}

export function groupJobsByStage(jobs: PipelineJob[]): StageGroup[] {
  const stageMap = new Map<string, PipelineJob[]>();
  const stageOrder: string[] = [];

  for (const job of jobs) {
    if (!stageMap.has(job.stage)) {
      stageMap.set(job.stage, []);
      stageOrder.push(job.stage);
    }
    stageMap.get(job.stage)!.push(job);
  }

  return stageOrder.map((name) => {
    const stageJobs = stageMap.get(name)!;
    return {
      name,
      jobs: stageJobs,
      status: aggregateStageStatus(stageJobs),
    };
  });
}
