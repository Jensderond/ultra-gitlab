/** Switch-styled toggle used on notification rows. */
export default function ToggleSwitch({
  checked,
  disabled,
  ariaLabel,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className={`companion-toggle ${checked ? 'active' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="companion-toggle-knob" />
    </button>
  );
}
