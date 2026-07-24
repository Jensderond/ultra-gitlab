import type { ReactNode } from 'react';

interface SettingsGroupProps {
  /** Uppercase eyebrow rendered above the card. */
  title?: string;
  /** Muted footnote rendered below the card (hints, saving state). */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Native-style settings group: a flat inset card whose children are
 * SettingsRow items separated by hairline dividers.
 */
export function SettingsGroup({ title, footer, children }: SettingsGroupProps) {
  return (
    <section className="settings-group-wrap">
      {title && <span className="settings-group-eyebrow">{title}</span>}
      <div className="settings-group">{children}</div>
      {footer && <div className="settings-group-footer">{footer}</div>}
    </section>
  );
}

interface SettingsRowProps {
  label?: ReactNode;
  description?: ReactNode;
  /** Stack the control full-width under the label (wide content). */
  vertical?: boolean;
  /** Associate the label with a form control. */
  htmlFor?: string;
  className?: string;
  children?: ReactNode;
}

/** One setting: label + description left, control right (or below). */
export function SettingsRow({
  label,
  description,
  vertical = false,
  htmlFor,
  className,
  children,
}: SettingsRowProps) {
  return (
    <div className={`settings-row${vertical ? ' settings-row--vertical' : ''}${className ? ` ${className}` : ''}`}>
      {(label || description) && (
        <div className="settings-row-text">
          {label && (htmlFor ? (
            <label className="settings-row-label" htmlFor={htmlFor}>{label}</label>
          ) : (
            <span className="settings-row-label">{label}</span>
          ))}
          {description && <span className="settings-row-desc">{description}</span>}
        </div>
      )}
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}
