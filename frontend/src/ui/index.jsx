/* ============================================================
   UI primitives (Light modern) — dùng chung toàn app.
   Thay style neo-brutalist inline lặp lại. Có framer-motion.
   ============================================================ */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const TONE = {
  accent:  { bg: 'var(--accent)',  ink: '#fff',            soft: 'var(--accent-soft)', softInk: 'var(--accent-ink)' },
  neutral: { bg: 'var(--surface-2)', ink: 'var(--text)',   soft: 'var(--surface-2)',   softInk: 'var(--text)' },
  danger:  { bg: 'var(--danger)',  ink: '#fff',            soft: '#fde8e8',            softInk: '#9b1c1c' },
  success: { bg: 'var(--success)', ink: '#fff',            soft: '#e3f6e9',            softInk: '#0f7a37' },
  info:    { bg: 'var(--info)',    ink: '#fff',            soft: '#e6effe',            softInk: '#1e40af' },
};
const SIZE = {
  sm: { padding: '6px 10px',  fontSize: 12, radius: 'var(--radius-sm)' },
  md: { padding: '9px 16px',  fontSize: 14, radius: 'var(--radius)' },
  lg: { padding: '13px 22px', fontSize: 16, radius: 'var(--radius)' },
};

export function Button({
  variant = 'solid', tone = 'accent', size = 'md',
  className = '', style = {}, disabled, children, ...rest
}) {
  const t = TONE[tone] || TONE.accent;
  const s = SIZE[size] || SIZE.md;
  const base = {
    solid:   { background: t.bg,   color: t.ink,     border: '1px solid transparent', boxShadow: 'var(--shadow-1)' },
    soft:    { background: t.soft, color: t.softInk, border: '1px solid transparent' },
    outline: { background: 'transparent', color: 'var(--text)', border: '1px solid var(--border-strong)' },
    ghost:   { background: 'transparent', color: 'var(--text-2)', border: '1px solid transparent' },
  }[variant] || {};
  return (
    <motion.button
      whileHover={disabled ? undefined : { y: -1, filter: 'brightness(1.04)' }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.12, ease: [0.22, 0.61, 0.36, 1] }}
      disabled={disabled}
      className={`focusable inline-flex items-center justify-center gap-1.5 font-bold select-none ${className}`}
      style={{
        padding: s.padding, fontSize: s.fontSize, borderRadius: s.radius,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--t), color var(--t), box-shadow var(--t)',
        ...base, ...style,
      }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function IconButton({ size = 40, className = '', style = {}, children, ...rest }) {
  return (
    <motion.button
      whileHover={{ y: -1 }} whileTap={{ scale: 0.94 }}
      className={`focusable inline-flex items-center justify-center ${className}`}
      style={{
        width: size, height: size, borderRadius: 'var(--radius)',
        background: 'var(--surface)', border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-1)', cursor: 'pointer', ...style,
      }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function Panel({ className = '', style = {}, children, ...rest }) {
  return (
    <div className={`panel ${className}`} style={style} {...rest}>{children}</div>
  );
}

export function Card({ className = '', style = {}, children, ...rest }) {
  return (
    <div className={`panel-2 ${className}`} style={style} {...rest}>{children}</div>
  );
}

export function Badge({ tone = 'neutral', className = '', style = {}, children }) {
  const t = TONE[tone] || TONE.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1 font-bold ${className}`}
      style={{
        background: t.soft, color: t.softInk, fontSize: 11,
        padding: '2px 8px', borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--border)', ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Modal({ open, onClose, title, maxWidth = 440, children }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
            background: 'rgba(38,30,16,0.42)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="panel"
            style={{ width: '100%', maxWidth, padding: 20 }}
          >
            {title && (
              <h2 className="font-extrabold text-center mb-3 pb-3"
                  style={{ fontSize: 18, borderBottom: '1px solid var(--border)' }}>
                {title}
              </h2>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* Màu người chơi theo tên slot color của backend */
export const PLAYER_COLOR = {
  red: 'var(--p-red)', blue: 'var(--p-blue)', white: 'var(--p-white)', orange: 'var(--p-orange)',
};
export const RES_COLOR = {
  wood: 'var(--r-wood)', brick: 'var(--r-brick)', sheep: 'var(--r-sheep)',
  wheat: 'var(--r-wheat)', ore: 'var(--r-ore)', gold: 'var(--r-gold)',
};
