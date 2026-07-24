import { useNavigate } from 'react-router-dom';
import { CaretLeftIcon } from './icons';
import './BackButton.css';

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
      <CaretLeftIcon size={16} />
    </button>
  );
}
