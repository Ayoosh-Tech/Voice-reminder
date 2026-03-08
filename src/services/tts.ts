import { GoogleGenAI, Modality } from "@google/genai";

interface SpeechResponse {
  data: string;
  mimeType: string;
}

export async function generateSpeech(text: string, voiceName: string = 'Kore'): Promise<SpeechResponse | null> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say clearly and naturally: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (inlineData?.data && inlineData?.mimeType) {
      return { data: inlineData.data, mimeType: inlineData.mimeType };
    }
    return null;
  } catch (error) {
    console.error("Error generating speech:", error);
    return null;
  }
}

function pcmToWav(base64Pcm: string, sampleRate: number = 24000): string {
  const pcmData = Uint8Array.from(atob(base64Pcm), c => c.charCodeAt(0));
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  // RIFF identifier
  view.setUint32(0, 0x52494646, false); // "RIFF"
  // file length
  view.setUint32(4, 36 + pcmData.length, true);
  // RIFF type
  view.setUint32(8, 0x57415645, false); // "WAVE"
  // format chunk identifier
  view.setUint32(12, 0x666d7420, false); // "fmt "
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  view.setUint32(36, 0x64617461, false); // "data"
  // data chunk length
  view.setUint32(40, pcmData.length, true);

  const combined = new Uint8Array(wavHeader.byteLength + pcmData.length);
  combined.set(new Uint8Array(wavHeader), 0);
  combined.set(pcmData, wavHeader.byteLength);

  let binary = '';
  const len = combined.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  return btoa(binary);
}

export function prepareAudio(speech: SpeechResponse): { data: string; mimeType: string } {
  let finalBase64 = speech.data;
  let finalMimeType = speech.mimeType;

  // If it's raw PCM, wrap it in a WAV header
  if (speech.mimeType.includes('pcm')) {
    // Extract sample rate if present (e.g., "audio/pcm;rate=24000")
    const rateMatch = speech.mimeType.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
    finalBase64 = pcmToWav(speech.data, sampleRate);
    finalMimeType = 'audio/wav';
  }

  return { data: finalBase64, mimeType: finalMimeType };
}

export function playAudio(speech: SpeechResponse) {
  try {
    const { data, mimeType } = prepareAudio(speech);
    const audioSrc = `data:${mimeType};base64,${data}`;
    const audio = new Audio(audioSrc);
    audio.play().catch(e => {
      console.error("Playback failed:", e);
    });
  } catch (error) {
    console.error("Error in playAudio:", error);
  }
}
