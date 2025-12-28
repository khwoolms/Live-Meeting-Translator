import React from 'react';

interface VisualizerProps {
  isActive: boolean;
  isModelSpeaking: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, isModelSpeaking }) => {
  return (
    <div className="flex items-center justify-center gap-1.5 h-16">
      {/* Visualizer Bars */}
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-2 rounded-full transition-all duration-150 ${
            isActive 
              ? isModelSpeaking 
                ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]' 
                : 'bg-emerald-500/20' 
              : 'bg-slate-800'
          }`}
          style={{
            height: isActive && isModelSpeaking 
              ? `${[24, 48, 32, 56, 24][i]}px` 
              : '8px',
            animation: isActive && isModelSpeaking ? `pulse 0.8s ease-in-out infinite ${i * 0.1}s` : 'none'
          }}
        />
      ))}
    </div>
  );
};

export default Visualizer;