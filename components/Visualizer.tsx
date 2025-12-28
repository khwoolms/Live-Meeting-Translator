
import React from 'react';

interface VisualizerProps {
  isActive: boolean;
  isModelSpeaking: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, isModelSpeaking }) => {
  return (
    <div className="flex items-center justify-center space-x-2 h-20">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className={`w-2 bg-blue-500 rounded-full transition-all duration-300 ${
            isActive ? 'animate-bounce' : 'h-2'
          } ${isModelSpeaking ? 'bg-green-400' : 'bg-blue-500'}`}
          style={{
            animationDelay: `${i * 0.1}s`,
            height: isActive ? `${20 + Math.random() * 40}px` : '8px'
          }}
        />
      ))}
    </div>
  );
};

export default Visualizer;
