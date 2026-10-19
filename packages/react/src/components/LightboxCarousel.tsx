import clsx from "clsx";
import { FC, MouseEvent, ReactNode, useCallback } from "react";

import { useEventListener, useProperty, useTimeout } from "../hooks";
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
 * LightboxCarousel component provides a carousel with lightbox functionality.
 */
export const LightboxCarousel: FC<LightboxCarouselProps> = ({ id, slides }) => {
  const [isOpen, setIsOpen] = useProperty(id, "isOpen", {
    defaultValue: false,
  });

  const [currentIndex, setCurrentIndex] = useProperty(id, "currentIndex", {
    defaultValue: 0,
  });

  const [showOverlay, setShowOverlay] = useProperty(id, "showOverlay", {
    defaultValue: false,
  });

  const openLightbox = useCallback(
    (index: number) => {
      setCurrentIndex(index);
      setShowOverlay(true);

      // Slight delay before setting isOpen so the fade-in starts from opacity: 0
      setTimeout(() => setIsOpen(true), 10);
    },
    [setCurrentIndex, setIsOpen, setShowOverlay]
  );

  const closeLightbox = useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

  // Remove the overlay after the fade-out; 300ms matches the CSS transition.
  useTimeout(() => setShowOverlay(false), !isOpen && showOverlay ? 300 : null);

  const showNext = useCallback(() => {
    setCurrentIndex((currentIndex + 1) % slides.length);
  }, [setCurrentIndex, currentIndex, slides.length]);

  const showPrev = useCallback(() => {
    setCurrentIndex((currentIndex - 1 + slides.length) % slides.length);
  }, [setCurrentIndex, currentIndex, slides.length]);

  // Keyboard Navigation
  useEventListener(
    isOpen ? window : null,
    "keyup",
    (e) => {
      if (e.key === "Escape") {
        closeLightbox();
      } else if (e.key === "ArrowRight") {
        showNext();
      } else if (e.key === "ArrowLeft") {
        showPrev();
      }
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true }
  );

  const handleThumbClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      const index = Number(e.currentTarget.dataset.index);
      openLightbox(index);
    },
    [openLightbox]
  );
  return (
    <div className={clsx("lightbox-carousel-container")}>
      <div className={clsx(styles.carouselThumbs)}>
        {slides.map((slide, index) => {
          return (
            <button
              key={index}
              type="button"
              data-index={index}
              className={clsx(styles.carouselThumb)}
              onClick={handleThumbClick}
            >
              <div>{slide.label}</div>
              <div>
                <Icon name="play" className={styles.carouselPlayIcon} />
              </div>
            </button>
          );
        })}
      </div>
      {showOverlay && (
        <div
          className={clsx(
            styles.lightboxOverlay,
            isOpen ? styles.open : styles.closed
          )}
        >
          <div className={clsx(styles.lightboxButtonCloseWrapper)}>
            <button
              type="button"
              className={styles.lightboxButtonClose}
              onClick={closeLightbox}
              aria-label="Close"
            >
              <Icon name="close" />
            </button>
          </div>
          {slides.length > 1 ? (
            <button
              type="button"
              className={clsx(styles.lightboxPreviewButton, styles.prev)}
              onClick={showPrev}
              aria-label="Previous"
            >
              <Icon name="previous" />
            </button>
          ) : (
            ""
          )}
          {slides.length > 1 ? (
            <button
              type="button"
              className={clsx(styles.lightboxPreviewButton, styles.next)}
              onClick={showNext}
              aria-label="Next"
            >
              <Icon name="next" />
            </button>
          ) : (
            ""
          )}
          <div
            key={`carousel-slide-${currentIndex}`}
            className={clsx(
              styles.lightboxContent,
              isOpen ? styles.open : styles.closed
            )}
          >
            {slides[currentIndex]?.render()}
          </div>
        </div>
      )}
    </div>
  );
};
