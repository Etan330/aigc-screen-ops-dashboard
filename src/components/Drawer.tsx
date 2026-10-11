import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export default function Drawer({ open, title, subtitle, badge, onClose, children }: DrawerProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-mask" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h3 className="drawer-title">{title}</h3>
            {subtitle ? <div className="drawer-sub">{subtitle}</div> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {badge}
            <button className="icon-btn" onClick={onClose} aria-label="关闭">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}
