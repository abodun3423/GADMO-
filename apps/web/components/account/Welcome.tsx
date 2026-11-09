import type { ReactNode } from 'react';
import type { Photo } from '@/lib/images';
import { AdirePattern } from '../home/AdirePattern';

/**
 * The top of every signed-in home: a night-indigo band with the Adire rings, a greeting,
 * one line of context and the main actions, and (on laptops) a photo of a skilled worker.
 */
export function Welcome({
  title,
  subtitle,
  photo,
  badge,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  photo?: Photo;
  /** A small status beside the title, e.g. Online. */
  badge?: ReactNode;
  /** Buttons and other actions. */
  children?: ReactNode;
}) {
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <AdirePattern className="welcome-pattern" />
      <div className="welcome-text">
        <div className="welcome-title-row">
          <h1 id="welcome-title" className="page-title">
            {title}
          </h1>
          {badge}
        </div>
        <p className="welcome-sub">{subtitle}</p>
        {children && <div className="welcome-actions">{children}</div>}
      </div>
      {photo && (
        <figure className="welcome-photo" aria-hidden="true">
          <img src={photo.src} alt="" width={560} height={695} decoding="async" />
        </figure>
      )}
    </section>
  );
}
