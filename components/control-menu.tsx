'use client';

import { useState } from 'react';
import {
  Settings,
  Mic,
  Send,
  MoreVertical,
  FileText,
  Volume2,
  Zap,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ControlMenuProps {
  onSettingsOpen: () => void;
  onMicToggle: () => void;
}

export function ControlMenu({ onSettingsOpen, onMicToggle }: ControlMenuProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);

  const handleMicToggle = () => {
    setIsMicActive(!isMicActive);
    onMicToggle();
  };

  const menuItems = [
    { icon: Mic, label: 'Voice', action: handleMicToggle },
    { icon: Volume2, label: 'Audio', action: () => console.log('[v0] Audio settings clicked') },
    { icon: FileText, label: 'Knowledge Base', action: () => console.log('[v0] Knowledge base clicked') },
    { icon: Settings, label: 'Settings', action: onSettingsOpen },
  ];

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3 sm:bottom-8 sm:right-8">
      {/* Badge with info */}
      <motion.div
        className="px-3 py-1.5 bg-cyan-400/10 border border-cyan-400/30 rounded-full text-xs font-mono text-cyan-300"
        animate={{ opacity: isExpanded ? 0 : 1 }}
        transition={{ duration: 0.2 }}
        pointerEvents={isExpanded ? 'none' : 'auto'}
      >
        AI Assistant Active
      </motion.div>

      {/* Menu items grid */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className="flex flex-col gap-2 mb-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
          >
            {menuItems.map((item, idx) => (
              <motion.button
                key={idx}
                className={`w-12 h-12 sm:w-14 sm:h-14 rounded-lg flex items-center justify-center transition-all border ${
                  item.label === 'Voice' && isMicActive
                    ? 'bg-cyan-400/20 border-cyan-400 text-cyan-400'
                    : 'bg-slate-900 border-slate-700 text-gray-400 hover:text-cyan-400 hover:border-cyan-400/50'
                }`}
                onClick={() => {
                  item.action();
                  if (item.label !== 'Settings') {
                    setIsExpanded(false);
                  }
                }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ delay: idx * 0.05 }}
                title={item.label}
              >
                <item.icon size={20} />
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary action button */}
      <motion.button
        className={`w-14 h-14 rounded-lg flex items-center justify-center font-semibold text-sm transition-all border-2 relative overflow-hidden ${
          isMicActive
            ? 'bg-cyan-400 text-black border-cyan-400 hover:bg-cyan-500'
            : 'bg-slate-900 text-cyan-400 border-cyan-400 hover:bg-slate-800'
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <AnimatePresence mode="wait">
          {isExpanded ? (
            <motion.div
              key="close"
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 90 }}
              transition={{ duration: 0.2 }}
            >
              <X size={24} />
            </motion.div>
          ) : (
            <motion.div
              key="menu"
              initial={{ scale: 0, rotate: 90 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: -90 }}
              transition={{ duration: 0.2 }}
            >
              <MoreVertical size={24} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Settings button - always visible */}
      <motion.button
        className="w-14 h-14 rounded-lg flex items-center justify-center font-semibold text-sm transition-all border-2 bg-slate-900 text-cyan-400 border-cyan-400 hover:bg-slate-800 hover:border-cyan-300"
        onClick={onSettingsOpen}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="Advanced Settings"
      >
        <Settings size={24} />
      </motion.button>
    </div>
  );
}
