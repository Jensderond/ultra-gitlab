import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ProjectCard from './ProjectCard';
import type { PipelineProject, PipelineStatus } from '../../types';

interface PinnedGridProps {
  projects: PipelineProject[];
  statuses: Map<number, PipelineStatus>;
  statusesLoading: boolean;
  onTogglePin: (projectId: number) => void;
  onRemove: (projectId: number) => void;
  onOpenDetail: (project: PipelineProject, status: PipelineStatus) => void;
  onReorder: (orderedIds: number[]) => void;
}

interface SortableCardProps {
  project: PipelineProject;
  status?: PipelineStatus;
  statusLoading: boolean;
  onTogglePin: (projectId: number) => void;
  onRemove: (projectId: number) => void;
  onOpenDetail: (project: PipelineProject, status: PipelineStatus) => void;
}

function SortableCard({ project, ...rest }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.projectId,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="pipelines-grid-item"
      {...attributes}
      {...listeners}
    >
      <ProjectCard project={project} {...rest} />
    </div>
  );
}

export default function PinnedGrid({
  projects,
  statuses,
  statusesLoading,
  onTogglePin,
  onRemove,
  onOpenDetail,
  onReorder,
}: PinnedGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const [activeId, setActiveId] = useState<number | null>(null);

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = projects.findIndex((p) => p.projectId === active.id);
    const newIndex = projects.findIndex((p) => p.projectId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(projects, oldIndex, newIndex);
    onReorder(next.map((p) => p.projectId));
  };

  void activeId;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e) => setActiveId(Number(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext
        items={projects.map((p) => p.projectId)}
        strategy={rectSortingStrategy}
      >
        <div className="pipelines-grid">
          {projects.map((project) => (
            <SortableCard
              key={project.projectId}
              project={project}
              status={statuses.get(project.projectId)}
              statusLoading={statusesLoading}
              onTogglePin={onTogglePin}
              onRemove={onRemove}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
