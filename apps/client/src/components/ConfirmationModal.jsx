import { useRef } from "react";
import { X } from "lucide-react";

export default function ConfirmationModal({ title, message, confirmLabel, onConfirm, onCancel }) {
  const backdropPointerStartedOutside = useRef(false);

  function trackBackdropPointerDown(event) {
    backdropPointerStartedOutside.current = event.target === event.currentTarget;
  }

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget && backdropPointerStartedOutside.current) {
      onCancel();
    }
    backdropPointerStartedOutside.current = false;
  }

  return (
    <div className="modal-backdrop" onPointerDown={trackBackdropPointerDown} onClick={handleBackdropClick}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onCancel}>
            <X size={20} />
          </button>
        </div>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="primary-button danger-button" type="button" onClick={onConfirm}>
            {confirmLabel || "Reset progress"}
          </button>
          <button className="ghost-button" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
