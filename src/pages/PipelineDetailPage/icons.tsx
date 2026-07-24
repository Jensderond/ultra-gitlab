import { ArrowSquareOut, Play, ArrowsClockwise, XCircle, Clock } from '@phosphor-icons/react';

export function ExternalLinkIcon() {
  return <ArrowSquareOut size={12} weight="bold" />;
}

export function PlayIcon() {
  return <Play size={12} weight="fill" />;
}

export function RetryIcon() {
  return <ArrowsClockwise size={12} weight="bold" />;
}

export function CancelIcon() {
  return <XCircle size={12} weight="bold" />;
}

export function RefreshIcon() {
  return <ArrowsClockwise size={14} weight="bold" />;
}

export function AutoRunIcon() {
  return <Clock size={12} weight="bold" />;
}
