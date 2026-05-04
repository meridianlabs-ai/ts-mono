import type { IHeaderParams } from "ag-grid-community";
import clsx from "clsx";
import { FC, Fragment, MouseEvent, useEffect, useRef, useState } from "react";

import styles from "./RotatedHeader.module.css";

type SortDir = "asc" | "desc" | null;

/**
 * Custom header rendered as a parallelogram-shaped label rotated 45°
 * up-and-to-the-right from the cell's bottom-right corner. Lets the
 * column be much narrower than the label while keeping it readable.
 *
 * Re-implements sort + filter affordances since they no longer come
 * from ag-grid's default `.ag-header-cell-label`.
 *
 * The visible filter button lives at the end of the rotated label
 * (where it reads naturally with the text), but the column-menu popup
 * is anchored off a *hidden* element at the cell's actual bottom-right
 * corner. `showColumnMenu` positions the menu relative to the anchor
 * element you hand it, so anchoring off a non-rotated element keeps
 * the popup directly under the column even though the visible button
 * is up-and-right of it on the rotated parallelogram.
 */
export const RotatedHeader: FC<IHeaderParams> = (props) => {
  const menuAnchorRef = useRef<HTMLSpanElement>(null);
  const [sort, setSort] = useState<SortDir>(null);
  const [filterActive, setFilterActive] = useState(false);

  useEffect(() => {
    const updateSort = () => setSort((props.column.getSort() ?? null) as SortDir);
    const updateFilter = () => setFilterActive(props.column.isFilterActive());
    props.column.addEventListener("sortChanged", updateSort);
    props.column.addEventListener("filterChanged", updateFilter);
    updateSort();
    updateFilter();
    return () => {
      props.column.removeEventListener("sortChanged", updateSort);
      props.column.removeEventListener("filterChanged", updateFilter);
    };
  }, [props.column]);

  const handleLabelClick = (e: MouseEvent) => {
    if (props.enableSorting) props.progressSort(e.shiftKey);
  };

  const handleFilterClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (menuAnchorRef.current) {
      props.showColumnMenu(menuAnchorRef.current);
    }
  };

  return (
    <Fragment>
      <div
        className={styles.label}
        onClick={handleLabelClick}
        title={props.displayName}
      >
        <span className={styles.text}>{props.displayName}</span>
        {sort && (
          <span
            className={clsx(
              "ag-icon",
              sort === "asc" ? "ag-icon-asc" : "ag-icon-desc",
              styles.sortIcon
            )}
            role="presentation"
          />
        )}
        {props.enableFilterButton && (
          <button
            type="button"
            className={clsx(
              styles.filterBtn,
              filterActive && styles.filterBtnActive
            )}
            onClick={handleFilterClick}
            aria-label="Filter"
          >
            <span
              className="ag-icon ag-icon-filter"
              role="presentation"
              aria-hidden="true"
            />
          </button>
        )}
      </div>
      {/* Hidden, un-rotated anchor at the cell's bottom-right — used
       *  only to position the column-menu popup so it appears under
       *  the actual column rather than offset along the rotation. */}
      <span ref={menuAnchorRef} className={styles.menuAnchor} aria-hidden="true" />
    </Fragment>
  );
};
