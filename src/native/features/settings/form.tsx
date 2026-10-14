/**
 * macOS-style form building blocks shared by Settings, Setup and the re-auth
 * sheet: inset grouped boxes with label-left / control-right rows, text
 * fields and popup buttons.
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from '../../ui/components';
import { ChevronDown } from '../../ui/icons';
import './form.css';

export function Group({
  title,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('st-group', className)}>
      {title && <h3 className="st-group__title">{title}</h3>}
      <div className="st-group__box">{children}</div>
      {footer && <p className="st-group__footer">{footer}</p>}
    </section>
  );
}

export function Row({
  label,
  description,
  htmlFor,
  children,
  className,
  stacked,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
  className?: string;
  /** Put the control under the label (for wide controls). */
  stacked?: boolean;
}) {
  return (
    <div className={cx('st-row', stacked && 'st-row--stacked', className)}>
      <div className="st-row__text">
        {htmlFor ? (
          <label className="st-row__label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="st-row__label">{label}</span>
        )}
        {description && <span className="st-row__desc">{description}</span>}
      </div>
      {children !== undefined && <div className="st-row__control">{children}</div>}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextField({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        aria-invalid={invalid || undefined}
        className={cx('st-input', invalid && 'is-invalid', className)}
        {...rest}
      />
    );
  },
);

/** A native <select> dressed as a macOS pop-up button. */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx('st-select', className)}>
      <select {...rest}>{children}</select>
      <ChevronDown size={11} strokeWidth={2.6} aria-hidden="true" />
    </span>
  );
}

/** Small inline error/notice line. */
export function Notice({ tone = 'error', children }: { tone?: 'error' | 'warn' | 'ok' | 'info'; children: ReactNode }) {
  return (
    <p className={cx('st-notice', `st-notice--${tone}`)} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  );
}

export const tokenPageUrl = (instanceUrl: string) =>
  `${instanceUrl.replace(/\/+$/, '')}/-/user_settings/personal_access_tokens?name=Ultra%20GitLab&scopes=api,read_user`;
