import { PushPin, X, MagnifyingGlass, ArrowSquareOut, DotsThreeVertical, GitBranch } from '@phosphor-icons/react';

export function PinIcon({ filled }: { filled: boolean }) {
  return <PushPin size={12} weight={filled ? 'fill' : 'regular'} />;
}

export function RemoveIcon({ filled = false }: { filled?: boolean } = {}) {
  return <X size={12} weight={filled ? 'fill' : 'bold'} />;
}

export function SearchIcon() {
  return <MagnifyingGlass size={14} weight="bold" opacity={0.5} />;
}

export function ExternalLinkIcon({ filled = false }: { filled?: boolean } = {}) {
  return <ArrowSquareOut size={12} weight={filled ? 'fill' : 'bold'} />;
}

export function MoreIcon() {
  return <DotsThreeVertical size={14} weight="bold" />;
}

export function BranchIcon() {
  return <GitBranch size={12} weight="bold" opacity={0.6} />;
}
