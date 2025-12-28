export const createPcmBlob = (channelData: Float32Array): Blob => {
  // Float32Array를 Int16Array(PCM)로 변환
  const pcmData = new Int16Array(channelData.length);
  for (let i = 0; i < channelData.length; i++) {
    // -1 ~ 1 사이로 클램핑
    const s = Math.max(-1, Math.min(1, channelData[i]));
    // 16비트 정수로 변환
    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return new Blob([pcmData], { type: 'audio/pcm' });
};

export const decode = (base64: string): ArrayBuffer => {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

export const decodeAudioData = async (
  audioData: ArrayBuffer,
  audioContext: AudioContext,
  sampleRate: number = 24000
): Promise<AudioBuffer> => {
  const pcm16 = new Int16Array(audioData);
  const audioBuffer = audioContext.createBuffer(1, pcm16.length, sampleRate);
  const channelData = audioBuffer.getChannelData(0);
  for (let i = 0; i < pcm16.length; i++) {
    channelData[i] = pcm16[i] / 32768.0;
  }
  return audioBuffer;
};