import { useCallback, useState, type AnimationEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PipelineJob, PipelineStatus } from '../../types';
import PipelineDetailView from './PipelineDetailView';
import { projectPathFromPipelineUrl } from './utils';
import '../PipelineDetailPage.css';

interface Props {
  instanceId: number;
  projectId: number;
  pipelineId: number;
  projectName: string;
  pipelineRef: string;
  pipelineWebUrl: string;
  onClose: () => void;
}

export function PipelineDetailDialog({
  instanceId,
  projectId: initialProjectId,
  pipelineId: initialPipelineId,
  projectName: initialProjectName,
  pipelineRef: initialRef,
  pipelineWebUrl: initialWebUrl,
  onClose,
}: Props) {
  const navigate = useNavigate();
  const [isClosing, setIsClosing] = useState(false);

  // History clicks swap which pipeline is displayed without leaving the
  // dialog; trigger-job clicks also swap the project (downstream pipelines
  // can live in another project).
  const [projectId, setProjectId] = useState(initialProjectId);
  const [projectName, setProjectName] = useState(initialProjectName);
  const [pipelineId, setPipelineId] = useState(initialPipelineId);
  const [pipelineRef, setPipelineRef] = useState(initialRef);
  const [pipelineWebUrl, setPipelineWebUrl] = useState(initialWebUrl);

  const beginClose = useCallback(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      onClose();
      return;
    }
    setIsClosing(true);
  }, [onClose]);

  const handleAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (isClosing && e.animationName === 'pipeline-detail-overlay-out') {
      onClose();
    }
  };

  const handleSelectPipeline = useCallback((pipeline: PipelineStatus) => {
    setPipelineId(pipeline.id);
    setPipelineRef(pipeline.refName);
    setPipelineWebUrl(pipeline.webUrl);
  }, []);

  const handleSelectJob = useCallback(
    (job: PipelineJob) => {
      // Trigger jobs swap the dialog to the downstream pipeline in place.
      if (job.isBridge) {
        const ds = job.downstreamPipeline;
        if (!ds?.projectId) return;
        setProjectId(ds.projectId);
        setProjectName(projectPathFromPipelineUrl(ds.webUrl) ?? projectName);
        setPipelineId(ds.id);
        setPipelineRef(ds.refName ?? '');
        setPipelineWebUrl(ds.webUrl);
        return;
      }
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
      onClose();
      navigate(`/pipelines/${projectId}/${pipelineId}/jobs/${job.id}?${params.toString()}`);
    },
    [navigate, onClose, instanceId, projectId, pipelineId, projectName, pipelineRef, pipelineWebUrl]
  );

  return (
    <div
      className={`pipeline-detail-dialog-overlay${isClosing ? ' is-closing' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) beginClose();
      }}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="pipeline-detail-dialog">
        <PipelineDetailView
          instanceId={instanceId}
          projectId={projectId}
          pipelineId={pipelineId}
          projectName={projectName}
          pipelineRef={pipelineRef}
          pipelineWebUrl={pipelineWebUrl}
          isActive={!isClosing}
          onClose={beginClose}
          onSelectPipeline={handleSelectPipeline}
          onSelectJob={handleSelectJob}
          backTitle="Close pipeline"
        />
      </div>
    </div>
  );
}
