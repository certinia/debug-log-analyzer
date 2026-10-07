import type { ReactElement, ReactNode } from 'react';
import styles from './styles.module.css';

function highlightTerms(item: string): ReactNode[] {
  return item.split('`').map((part, i) =>
    i % 2 === 1 ? (
      <span key={part} className={styles.term}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** A ✓ list whose items may mark terms of art with backticks, e.g. "Every `SOQL` statement". */
export default function CheckList({ items }: { items: string[] }): ReactElement {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item}>{highlightTerms(item)}</li>
      ))}
    </ul>
  );
}
