/**
 * The top of a page that is not the grid: a title, a line under it, and
 * whatever can be done to the page, on the right.
 *
 * One component so the term page, the review screen, the disk and settings
 * share a header and read as one application rather than four.
 */

import { Heading } from "@primer/react";

export interface PageHeadProps {
  readonly title: React.ReactNode;
  /** One line under the title. */
  readonly detail?: React.ReactNode;
  /** Buttons, on the right. */
  readonly children?: React.ReactNode;
  /** Above the title: a trail back up. */
  readonly above?: React.ReactNode;
}

export function PageHead({ title, detail, children, above }: PageHeadProps): React.JSX.Element {
  return (
    <header className="yk-page-head">
      <div className="yk-page-head-text">
        {above}
        <Heading as="h1" className="yk-page-title">
          {title}
        </Heading>
        {detail && <div className="yk-page-detail">{detail}</div>}
      </div>
      {children && <div className="yk-page-head-end">{children}</div>}
    </header>
  );
}
