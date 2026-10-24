/**
 * Offers the newer version of the app once it has downloaded. Refresh
 * reloads into it; Later hides the offer (it comes back on the next check).
 */
export function UpdateBanner({
  onRefresh,
  onDismiss,
}: {
  onRefresh: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="update-banner" role="status">
      <p>A new version of Enough Money is available.</p>
      <div className="update-banner-actions">
        <button className="update-later" type="button" onClick={onDismiss}>
          Later
        </button>
        <button className="update-refresh" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </div>
  );
}
