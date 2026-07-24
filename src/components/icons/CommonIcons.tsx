import {
  MagnifyingGlass,
  X,
  Check,
  CaretLeft,
  CaretRight,
  CaretDown,
  ArrowsClockwise,
  SealCheck,
  PencilSimple,
  Star,
  Copy,
  File,
  ChatCircle,
} from '@phosphor-icons/react';

export function SearchIcon({ size = 16 }: { size?: number } = {}) {
  return <MagnifyingGlass size={size} weight="bold" />;
}

export function CloseIcon({ size = 12 }: { size?: number } = {}) {
  return <X size={size} weight="bold" />;
}

export function CheckIcon({ size = 14 }: { size?: number } = {}) {
  return <Check size={size} weight="bold" />;
}

export function CheckCircleIcon({ size = 14 }: { size?: number } = {}) {
  return <SealCheck size={size} weight="fill" />;
}

export function CaretLeftIcon({ size = 16 }: { size?: number } = {}) {
  return <CaretLeft size={size} weight="bold" />;
}

export function CaretRightIcon({ size = 16 }: { size?: number } = {}) {
  return <CaretRight size={size} weight="bold" />;
}

export function CaretDownIcon({ size = 12 }: { size?: number } = {}) {
  return <CaretDown size={size} weight="bold" />;
}

export function RefreshIcon({ size = 14 }: { size?: number } = {}) {
  return <ArrowsClockwise size={size} weight="bold" />;
}

export function PencilIcon({ size = 14 }: { size?: number } = {}) {
  return <PencilSimple size={size} weight="bold" />;
}

export function StarIcon({ filled, size = 16 }: { filled: boolean; size?: number }) {
  return <Star size={size} weight={filled ? 'fill' : 'regular'} />;
}

export function CopyIcon({ size = 14 }: { size?: number } = {}) {
  return <Copy size={size} weight="bold" />;
}

export function FileIcon({ size = 16 }: { size?: number } = {}) {
  return <File size={size} weight="bold" />;
}

export function ChatCircleIcon({ size = 18 }: { size?: number } = {}) {
  return <ChatCircle size={size} weight="bold" />;
}
