import Link from '@docusaurus/Link';
import { MARKETPLACE_URL } from '@site/src/constants';
import type { ReactElement, ReactNode } from 'react';
import shared from '../shared.module.css';

export default function InstallButtons({ children }: { children?: ReactNode }): ReactElement {
  return (
    <div className={shared.actions}>
      <Link className="button button--primary button--lg" href={MARKETPLACE_URL}>
        Install for VS Code
      </Link>
      <Link className="button button--secondary button--lg" to="/docs/gettingstarted">
        Get started
      </Link>
      {children}
    </div>
  );
}
