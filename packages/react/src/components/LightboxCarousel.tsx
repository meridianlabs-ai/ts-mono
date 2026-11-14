import clsx from "clsx";
import { FC, ReactNode } from "react";
import { createPortal } from "react-dom";

import { useProperty, useShowModal } from "../hooks";
import { Icon } from "../icons";

import styles from "./LightboxCarousel.module.css";

interface Slide {
  label: string;
  render: () => ReactNode;
}

interface LightboxCarouselProps {
  id: string;
  slides: Slide[];
}

/**
 * Thumbnails that open their slides full screen in a modal `<dialog>`.
 * Escape and the close button close it; the arrow keys and the side buttons
 * step between slides.
 */
export const LightboxCarousel: FC<LightboxCarouselProps> = ({ id, slides }) => {
  const [isOpen, setIsOpen] = useProperty(id, "isOpen", {
    defaultValue: false,
  });
  const [currentIndex, setCurrentIndex] = useProperty(id, "currentIndex", {
    defaultValue: 0,
  });

  return (
    <div className={clsx("lightbox-carousel-container")}>
      <div className={clsx(styles.carouselThumbs)}>
        {slides.map((slide, index) => (
          <button
            key={index}
            type="button"
            className={clsx(styles.carouselThumb)}
            onClick={() => {
              setCurrentIndex(index);
              setIsOpen(true);
            }}
          >
            <div>{slide.label}</div>
            <div>
              <Icon name="play" className={styles.carouselPlayIcon} />
            </div>
          </button>
        ))}
      </div>
      {isOpen && (
        <Lightbox
          slides={slides}
          index={currentIndex}
          onIndexChange={setCurrentIndex}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};

interface LightboxProps {
  slides: Slide[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const Lightbox: FC<LightboxProps> = ({
  slides,
  index,
  onIndexChange,
  onClose,
}) => {
  const { ref, dialog } = useShowModal();
  const step = (delta: number) =>
    onIndexChange((index + delta + slides.length) % slides.length);

  return createPortal(
    <dialog
      ref={ref}
      aria-label={slides[index]?.label}
      className={styles.lightbox}
      // Handled here rather than left to the dialog: the terminal player
      // cancels the Escape keydown when it has focus, which would keep the
      // dialog open.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "ArrowRight") step(1);
        else if (e.key === "ArrowLeft") step(-1);
      }}
      // An Escape this handler didn't see (focus on <body>) closes the dialog
      // natively. The event is queued: skip it if the dialog is open again
      // already (React re-runs the ref that opens it in StrictMode).
      onClose={(e) => {
        if (!e.currentTarget.open) onClose();
      }}
    >
      <button
        type="button"
        className={styles.lightboxButtonClose}
        onClick={onClose}
        aria-label="Close"
      >
        <Icon name="close" />
      </button>
      {slides.length > 1 && (
        <>
          <button
            type="button"
            className={clsx(styles.lightboxPreviewButton, styles.prev)}
            onClick={() => step(-1)}
            aria-label="Previous"
          >
            <Icon name="previous" />
          </button>
          <button
            type="button"
            className={clsx(styles.lightboxPreviewButton, styles.next)}
            onClick={() => step(1)}
            aria-label="Next"
          >
            <Icon name="next" />
          </button>
        </>
      )}
      {dialog && (
        <div key={index} className={styles.lightboxContent}>
          {slides[index]?.render()}
        </div>
      )}
    </dialog>,
    document.body
  );
};
