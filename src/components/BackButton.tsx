import { useNavigate } from 'react-router-dom';
import './BackButton.css';

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
    </svg>
  );
}

interface BackButtonProps {
  to?: string;
  onClick?: () => void;
  title?: string;
}

export default function BackButton({ to, onClick, title = 'Go back' }: BackButtonProps) {
  const navigate = useNavigate();

  const handleClick = onClick ?? (() => {
    if (to) navigate(to);
    else navigate(-1);
  });

  return (
    <button className="back-button-icon" onClick={handleClick} title={title}>
      <ChevronLeftIcon />
    </button>
  );
}
