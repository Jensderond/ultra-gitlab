/**
 * Pipeline detail page showing jobs grouped by stage.
 *
 * Route wrapper around PipelineDetailView — parses URL params and translates
 * navigation actions into route changes.
 */

import { useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import type { PipelineJob, PipelineStatus } from '../../types';
import PipelineDetailView from './PipelineDetailView';
import '../PipelineDetailPage.css';

export default function PipelineDetailPage() {
  const { projectId, pipelineId } = useParams<{ projectId: string; pipelineId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const instanceId = Number(searchParams.get('instance') || 0);
  const projectName = searchParams.get('project') || '';
  const pipelineRef = searchParams.get('ref') || '';
  const pipelineWebUrl = searchParams.get('url') || '';

  const pid = Number(projectId);
  const plid = Number(pipelineId);

  const handleClose = useCallback(() => {
    navigate('/pipelines');
  }, [navigate]);

  const handleSelectPipeline = useCallback(
    (pipeline: PipelineStatus) => {
      const params = new URLSearchParams({
        instance: String(instanceId),
        project: projectName,
        ref: pipeline.refName,
        url: pipeline.webUrl,
      });
      navigate(`/pipelines/${pid}/${pipeline.id}?${params.toString()}`);
    },
    [navigate, instanceId, pid, projectName]
  );

  const handleSelectJob = useCallback(
    (job: PipelineJob) => {
      const params = new URLSearchParams({
        instance: String(instanceId),
        name: job.name,
        status: job.status,
        stage: job.stage,
        project: projectName,
        ref: pipelineRef,
      });
      if (job.duration != null) {
        params.set('duration', String(job.duration));
      }
      if (pipelineWebUrl) {
        params.set('url', pipelineWebUrl);
      }
      if (job.webUrl) {
        params.set('jobUrl', job.webUrl);
      }
      navigate(`/pipelines/${pid}/${plid}/jobs/${job.id}?${params.toString()}`);
    },
    [navigate, instanceId, pid, plid, projectName, pipelineRef, pipelineWebUrl]
  );

  return (
    <PipelineDetailView
      instanceId={instanceId}
      projectId={pid}
      pipelineId={plid}
      projectName={projectName}
      pipelineRef={pipelineRef}
      pipelineWebUrl={pipelineWebUrl}
      isActive={true}
      onClose={handleClose}
      onSelectPipeline={handleSelectPipeline}
      onSelectJob={handleSelectJob}
    />
  );
}
