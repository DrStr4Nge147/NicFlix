import { X } from "lucide-react";

export default function ConfirmationModal({ title, message, confirmLabel, onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
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
