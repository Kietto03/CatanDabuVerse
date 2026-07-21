import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { Button } from '../ui';

function ChatWidget() {
  const gameState = useGameStore((state) => state.gameState);
  const socket = useGameStore((state) => state.socket);
  const [chatInput, setChatInput] = useState('');
  const isCollapsed = useGameStore((state) => state.chatCollapsed);
  const toggleChat = useGameStore((state) => state.toggleChat);
  const logEndRef = useRef(null);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [gameState?.gameLog, isCollapsed]);

  if (!gameState) return null;

  const mySlot = gameState.slots.find((s) => s.id === socket.id);
  const myUsername = mySlot ? mySlot.username : '';

  const handleSend = (e) => {
    e.preventDefault();
    if (chatInput.trim()) { socket.emit('chatMessage', chatInput.trim()); setChatInput(''); }
  };

  if (isCollapsed) {
    return (
      <Button variant="solid" tone="neutral" onClick={toggleChat} className="rounded-full" style={{ boxShadow: 'var(--shadow-2)' }}>
        💬 Chat &amp; Nhật ký
        {gameState.gameLog.length > 0 && (
          <span className="ml-1 font-black text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--danger)', color: '#fff' }}>!</span>
        )}
      </Button>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}
      className="panel flex flex-col gap-2 w-[min(20rem,calc(100vw-5rem))] h-[min(380px,60vh)] p-4 overflow-hidden">
      <div className="flex items-center justify-between pb-2 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>📢 Chat &amp; Nhật ký</span>
        <button onClick={toggleChat} className="focusable font-extrabold text-xs cursor-pointer p-0.5" style={{ color: 'var(--muted)' }} title="Thu gọn">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto text-xs leading-relaxed flex flex-col gap-2.5 pr-1" style={{ color: 'var(--text)' }}>
        {gameState.gameLog.map((log, index) => {
          const chatPrefix = '[CHAT] ';
          if (log.startsWith(chatPrefix)) {
            const content = log.substring(chatPrefix.length);
            const colonIdx = content.indexOf(': ');
            const sender = colonIdx !== -1 ? content.substring(0, colonIdx) : 'System';
            const message = colonIdx !== -1 ? content.substring(colonIdx + 2) : content;
            const isMe = sender === myUsername;
            const senderSlot = gameState.slots.find((s) => s.username === sender);
            const color = senderSlot ? senderSlot.color : 'var(--muted)';
            return (
              <div key={index} className={`flex flex-col gap-0.5 max-w-[85%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`}>
                <span className="text-[9px] font-extrabold" style={{ color: isMe ? 'var(--accent-ink)' : color }}>{sender}{isMe && ' (Bạn)'}</span>
                <div className="rounded-xl px-3 py-1.5 text-xs font-bold break-all leading-relaxed"
                  style={isMe
                    ? { background: 'var(--accent)', color: '#fff', borderTopRightRadius: 2 }
                    : { background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderTopLeftRadius: 2 }}>
                  {message}
                </div>
              </div>
            );
          }
          return (
            <div key={index} className="text-[10px] font-semibold italic px-2.5 py-1.5 rounded-lg max-w-[95%] self-start leading-snug"
              style={{ color: 'var(--text-2)', background: 'var(--surface-2)', borderLeft: '3px solid var(--accent)' }}>
              ⚙️ {log}
            </div>
          );
        })}
        <div ref={logEndRef} />
      </div>

      <form onSubmit={handleSend} className="flex gap-2 pt-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
        <input type="text" placeholder="Nhắn tin…" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
          className="focusable flex-1 px-3 py-2 text-xs font-bold"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', color: 'var(--text)' }} />
        <Button type="submit" variant="solid" tone="accent" size="sm" disabled={!chatInput.trim()}>Gửi</Button>
      </form>
    </motion.div>
  );
}

export default ChatWidget;
