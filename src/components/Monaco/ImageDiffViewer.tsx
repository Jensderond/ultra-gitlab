/**
 * Image diff viewer component.
 *
 * Displays side-by-side or overlay comparison of image changes.
 */

import { useState, useCallback } from "react";
import "./ImageDiffViewer.css";

type ViewMode = "side-by-side" | "overlay" | "swipe";

interface ImageDiffViewerProps {
  /** Original image as base64-encoded string */
  originalBase64: string;
  /** Modified image as base64-encoded string */
  modifiedBase64: string;
  /** File path for display */
  filePath: string;
  /** MIME type of the image */
  mimeType: string;
}

/**
 * Image diff viewer component for visual comparison of image changes.
 */
export function ImageDiffViewer({
  originalBase64,
  modifiedBase64,
  filePath,
  mimeType,
}: ImageDiffViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("side-by-side");
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [swipePosition, setSwipePosition] = useState(50);
  const [zoom, setZoom] = useState(100);
  const [isDragging, setIsDragging] = useState(false);

  // Build data URLs - only compute when base64 content exists
  const originalDataUrl = originalBase64 ? `data:${mimeType};base64,${originalBase64}` : null;
  const modifiedDataUrl = modifiedBase64 ? `data:${mimeType};base64,${modifiedBase64}` : null;

  // SVGs without explicit width/height collapse in <img> — need explicit sizing
  const isSvg = mimeType === "image/svg+xml";
  const imgClass = isSvg ? "svg-image" : undefined;

  // Determine change type
  const isNewFile = !originalBase64 && !!modifiedBase64;
  const isDeletedFile = !!originalBase64 && !modifiedBase64;
  const isModified = !!originalBase64 && !!modifiedBase64;

  // Handle swipe drag
  const handleSwipeMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSwipePosition(percentage);
    },
    [isDragging]
  );

  const handleSwipeStart = useCallback(() => setIsDragging(true), []);
  const handleSwipeEnd = useCallback(() => setIsDragging(false), []);

  // Extract filename for display
  const filename = filePath.split("/").pop() || filePath;

  return (
    <div className="image-diff-viewer">
      <div className="image-diff-toolbar">
        <div className="image-diff-filename">{filename}</div>

        <div className="image-diff-controls">
          {isModified && (
            <div className="image-diff-view-modes">
              <button
                className={viewMode === "side-by-side" ? "active" : ""}
                onClick={() => setViewMode("side-by-side")}
                title="Side by side"
              >
                Side by Side
              </button>
              <button
                className={viewMode === "overlay" ? "active" : ""}
                onClick={() => setViewMode("overlay")}
                title="Overlay with opacity"
              >
                Overlay
              </button>
              <button
                className={viewMode === "swipe" ? "active" : ""}
                onClick={() => setViewMode("swipe")}
                title="Swipe comparison"
              >
                Swipe
              </button>
            </div>
          )}

          <div className="image-diff-zoom">
            <button
              onClick={() => setZoom((z) => Math.max(25, z - 25))}
              disabled={zoom <= 25}
            >
              -
            </button>
            <span>{zoom}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(400, z + 25))}
              disabled={zoom >= 400}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="image-diff-content">
        {isNewFile && (
          <div className="image-diff-single added">
            <div className="image-diff-label">Added</div>
            <div
              className="image-diff-image-container"
              style={{ transform: `scale(${zoom / 100})` }}
            >
              <img className={imgClass} src={modifiedDataUrl!} alt="Added file" />
            </div>
          </div>
        )}

        {isDeletedFile && (
          <div className="image-diff-single deleted">
            <div className="image-diff-label">Deleted</div>
            <div
              className="image-diff-image-container"
              style={{ transform: `scale(${zoom / 100})` }}
            >
              <img className={imgClass} src={originalDataUrl!} alt="Deleted file" />
            </div>
          </div>
        )}

        {isModified && viewMode === "side-by-side" && (
          <div className="image-diff-side-by-side">
            <div className="image-diff-panel original">
              <div className="image-diff-label">Original</div>
              <div
                className="image-diff-image-container"
                style={{ transform: `scale(${zoom / 100})` }}
              >
                <img className={imgClass} src={originalDataUrl!} alt="Original" />
              </div>
            </div>
            <div className="image-diff-panel modified">
              <div className="image-diff-label">Modified</div>
              <div
                className="image-diff-image-container"
                style={{ transform: `scale(${zoom / 100})` }}
              >
                <img className={imgClass} src={modifiedDataUrl!} alt="Modified" />
              </div>
            </div>
          </div>
        )}

        {isModified && viewMode === "overlay" && (
          <div className="image-diff-overlay-container">
            <div className="image-diff-overlay-control">
              <span>Original</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
              />
              <span>Modified</span>
            </div>
            <div
              className="image-diff-overlay"
              style={{ transform: `scale(${zoom / 100})` }}
            >
              <img
                className={`image-diff-overlay-original${isSvg ? " svg-image" : ""}`}
                src={originalDataUrl!}
                alt="Original"
                style={{ opacity: 1 - overlayOpacity }}
              />
              <img
                className={`image-diff-overlay-modified${isSvg ? " svg-image" : ""}`}
                src={modifiedDataUrl!}
                alt="Modified"
                style={{ opacity: overlayOpacity }}
              />
            </div>
          </div>
        )}

        {isModified && viewMode === "swipe" && (
          <div
            className="image-diff-swipe-container"
            onMouseMove={handleSwipeMove}
            onMouseUp={handleSwipeEnd}
            onMouseLeave={handleSwipeEnd}
          >
            <div
              className="image-diff-swipe"
              style={{ transform: `scale(${zoom / 100})` }}
            >
              <img
                className={`image-diff-swipe-original${isSvg ? " svg-image" : ""}`}
                src={originalDataUrl!}
                alt="Original"
              />
              <div
                className="image-diff-swipe-modified-wrapper"
                style={{ clipPath: `inset(0 ${100 - swipePosition}% 0 0)` }}
              >
                <img
                  className={`image-diff-swipe-modified${isSvg ? " svg-image" : ""}`}
                  src={modifiedDataUrl!}
                  alt="Modified"
                />
              </div>
              <div
                className="image-diff-swipe-handle"
                style={{ left: `${swipePosition}%` }}
                onMouseDown={handleSwipeStart}
              >
                <div className="image-diff-swipe-handle-line" />
                <div className="image-diff-swipe-handle-grip">
                  <span>◀</span>
                  <span>▶</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {!originalBase64 && !modifiedBase64 && (
          <div className="image-diff-empty">
            <p>No image data available</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ImageDiffViewer;
