import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Bell, BellOff, Clock, Volume2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generateSpeech, playAudio, prepareAudio } from './services/tts';

interface Alarm {
  id: string;
  time: string; // HH:mm
  reminder: string;
  enabled: boolean;
  triggeredToday: boolean;
  repeatDays: number[]; // 0-6 (Sunday-Saturday)
  snoozedUntil: string | null; // HH:mm
  voice: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];

const addMinutesToTime = (time: string, minutes: number): string => {
  const [hours, mins] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, mins + minutes);
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

export default function App() {
  const [alarms, setAlarms] = useState<Alarm[]>(() => {
    const saved = localStorage.getItem('voice_alarms');
    const parsed = saved ? JSON.parse(saved) : [];
    // Migration: ensure all alarms have repeatDays, snoozedUntil, and voice
    return parsed.map((a: any) => ({
      ...a,
      repeatDays: a.repeatDays || [0, 1, 2, 3, 4, 5, 6],
      snoozedUntil: a.snoozedUntil || null,
      voice: a.voice || 'Kore'
    }));
  });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [newTime, setNewTime] = useState('08:00');
  const [newReminder, setNewReminder] = useState('');
  const [newVoice, setNewVoice] = useState('Kore');
  const [newRepeatDays, setNewRepeatDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeAlarm, setActiveAlarm] = useState<Alarm | null>(null);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('voice_alarm_volume');
    return saved ? parseFloat(saved) : 0.8;
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Save volume to localStorage
  useEffect(() => {
    localStorage.setItem('voice_alarm_volume', volume.toString());
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Save alarms to localStorage
  useEffect(() => {
    localStorage.setItem('voice_alarms', JSON.stringify(alarms));
  }, [alarms]);

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);
      checkAlarms(now);
    }, 1000);
    return () => clearInterval(timer);
  }, [alarms]);

  const checkAlarms = async (now: Date) => {
    const currentHHmm = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const currentDay = now.getDay();
    
    const triggeredAlarms = alarms.filter(alarm => {
      if (!alarm.enabled) return false;
      const isBaseTime = alarm.time === currentHHmm && !alarm.triggeredToday && alarm.repeatDays.includes(currentDay);
      const isSnoozeTime = alarm.snoozedUntil === currentHHmm;
      return isBaseTime || isSnoozeTime;
    });

    if (triggeredAlarms.length > 0) {
      // Mark as triggered immediately to prevent double trigger
      setAlarms(prev => prev.map(a => {
        const isTriggered = triggeredAlarms.some(ta => ta.id === a.id);
        if (isTriggered) {
          return { 
            ...a, 
            triggeredToday: a.time === currentHHmm ? true : a.triggeredToday,
            snoozedUntil: null // Clear snooze once it triggers
          };
        }
        return a;
      }));

      // For simplicity, we trigger the first one if multiple hit at once
      handleTrigger(triggeredAlarms[0]);
    }

    // Reset triggeredToday at midnight
    if (currentHHmm === '00:00') {
      setAlarms(prev => prev.map(a => ({ ...a, triggeredToday: false, snoozedUntil: null })));
    }
  };

  const handleTrigger = async (alarm: Alarm) => {
    setActiveAlarm(alarm);
    setIsProcessing(true);
    const repeatedReminder = Array(5).fill(alarm.reminder).join('. ');
    const speechText = `Reminder: ${repeatedReminder}`;
    const audioData = await generateSpeech(speechText, alarm.voice);
    if (audioData) {
      const { data, mimeType } = prepareAudio(audioData);
      const audioSrc = `data:${mimeType};base64,${data}`;
      const audio = new Audio(audioSrc);
      audio.loop = true; // Loop until dismissed or snoozed
      audio.volume = volume;
      audioRef.current = audio;
      audio.play().catch(e => console.error("Playback failed:", e));
    }
    setIsProcessing(false);
  };

  const snoozeAlarm = (minutes: number) => {
    if (!activeAlarm) return;
    
    const snoozeTime = addMinutesToTime(currentTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), minutes);
    
    setAlarms(prev => prev.map(a => 
      a.id === activeAlarm.id ? { ...a, snoozedUntil: snoozeTime } : a
    ));
    
    dismissActiveAlarm();
  };

  const dismissActiveAlarm = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setActiveAlarm(null);
  };

  const addAlarm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTime || !newReminder || newRepeatDays.length === 0) return;

    const newAlarm: Alarm = {
      id: crypto.randomUUID(),
      time: newTime,
      reminder: newReminder,
      enabled: true,
      triggeredToday: false,
      repeatDays: [...newRepeatDays],
      snoozedUntil: null,
      voice: newVoice,
    };

    setAlarms(prev => [...prev].concat(newAlarm).sort((a, b) => a.time.localeCompare(b.time)));
    setNewReminder('');
  };

  const toggleDay = (day: number) => {
    setNewRepeatDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const deleteAlarm = (id: string) => {
    setAlarms(prev => prev.filter(a => a.id !== id));
  };

  const toggleAlarm = (id: string) => {
    setAlarms(prev => prev.map(a => 
      a.id === id ? { ...a, enabled: !a.enabled } : a
    ));
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center py-12 px-4 sm:px-6">
      <AnimatePresence>
        {activeAlarm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/90 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-sm rounded-[40px] p-8 text-center space-y-8 shadow-2xl"
            >
              <div className="space-y-2">
                <div className="w-20 h-20 bg-zinc-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                  <Bell className="w-10 h-10 text-zinc-900" />
                </div>
                <h2 className="text-4xl font-mono font-bold text-zinc-900">{activeAlarm.time}</h2>
                <p className="text-xl text-zinc-500 font-medium">{activeAlarm.reminder}</p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div className="flex gap-2">
                  <button 
                    onClick={() => snoozeAlarm(5)}
                    className="flex-1 py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-bold hover:bg-zinc-200 transition-all"
                  >
                    Snooze 5m
                  </button>
                  <button 
                    onClick={() => snoozeAlarm(10)}
                    className="flex-1 py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-bold hover:bg-zinc-200 transition-all"
                  >
                    Snooze 10m
                  </button>
                </div>
                <button 
                  onClick={dismissActiveAlarm}
                  className="w-full py-5 bg-zinc-900 text-white rounded-3xl font-bold text-lg hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-900/20"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full max-w-md space-y-8">
        {/* Header / Clock */}
        <div className="text-center space-y-2">
          <div className="flex justify-end mb-2">
            <div className="bg-white px-4 py-2 rounded-2xl border border-zinc-200 shadow-sm flex items-center gap-3 w-48">
              <Volume2 className="w-4 h-4 text-zinc-400" />
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.01" 
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="flex-1 h-1 bg-zinc-100 rounded-lg appearance-none cursor-pointer accent-zinc-900"
              />
            </div>
          </div>
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center justify-center p-3 bg-white rounded-2xl shadow-sm border border-zinc-200 mb-4"
          >
            <Clock className="w-5 h-5 text-zinc-400 mr-2" />
            <span className="text-4xl font-light tracking-tight text-zinc-900 font-mono">
              {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </span>
          </motion.div>
          <h1 className="text-2xl font-semibold text-zinc-900">Voice Reminders</h1>
          <p className="text-zinc-500 text-sm">Set an alarm and I'll speak your reminder.</p>
        </div>

        {/* Add Alarm Form */}
        <motion.form 
          onSubmit={addAlarm}
          className="bg-white p-6 rounded-3xl shadow-sm border border-zinc-200 space-y-4"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1 ml-1">Time</label>
              <input 
                type="time" 
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all font-mono text-lg"
              />
            </div>
            <div className="flex-[2]">
              <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1 ml-1">Reminder</label>
              <input 
                type="text" 
                placeholder="Take vitamins..."
                value={newReminder}
                onChange={(e) => setNewReminder(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 focus:border-transparent outline-none transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 ml-1">Repeat</label>
            <div className="flex justify-between gap-1">
              {DAYS.map((day, idx) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(idx)}
                  className={`flex-1 py-2 text-[10px] font-bold rounded-xl transition-all ${
                    newRepeatDays.includes(idx)
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-400 hover:bg-zinc-200'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 ml-1">Voice</label>
            <div className="flex flex-wrap gap-2">
              {VOICES.map((voice) => (
                <button
                  key={voice}
                  type="button"
                  onClick={() => setNewVoice(voice)}
                  className={`px-3 py-2 text-[10px] font-bold rounded-xl transition-all ${
                    newVoice === voice
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-400 hover:bg-zinc-200'
                  }`}
                >
                  {voice}
                </button>
              ))}
            </div>
          </div>

          <button 
            type="submit"
            className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-medium hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2 group"
          >
            <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />
            Add Alarm
          </button>
        </motion.form>

        {/* Alarms List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Active Alarms</h2>
            {isProcessing && (
              <div className="flex items-center gap-2 text-zinc-400 text-xs">
                <Loader2 className="w-3 h-3 animate-spin" />
                Processing...
              </div>
            )}
          </div>
          
          <AnimatePresence mode="popLayout">
            {alarms.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-12 bg-zinc-100/50 rounded-3xl border border-dashed border-zinc-200"
              >
                <BellOff className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
                <p className="text-zinc-400 text-sm">No alarms set</p>
              </motion.div>
            ) : (
              alarms.map((alarm) => (
                <motion.div
                  key={alarm.id}
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className={`group flex items-center justify-between p-5 rounded-3xl border transition-all ${
                    alarm.enabled 
                      ? 'bg-white border-zinc-200 shadow-sm' 
                      : 'bg-zinc-50 border-zinc-100 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => toggleAlarm(alarm.id)}
                      className={`p-3 rounded-2xl transition-colors ${
                        alarm.enabled ? 'bg-zinc-900 text-white' : 'bg-zinc-200 text-zinc-500'
                      }`}
                    >
                      {alarm.enabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
                    </button>
                    <div>
                      <div className="text-2xl font-mono font-medium text-zinc-900 leading-none mb-1">
                        {alarm.time}
                      </div>
                      <div className="text-xs text-zinc-400 font-medium mb-1">
                        {alarm.repeatDays.length === 7 
                          ? 'Daily' 
                          : alarm.repeatDays.length === 0 
                            ? 'Never' 
                            : alarm.repeatDays.map(d => DAYS[d]).join(', ')}
                        {alarm.snoozedUntil && (
                          <span className="ml-2 text-indigo-500 font-bold">
                            • Snoozed until {alarm.snoozedUntil}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-zinc-500 flex items-center gap-1">
                        <Volume2 className="w-3 h-3" />
                        <span className="font-medium text-zinc-400 text-xs mr-1">[{alarm.voice}]</span>
                        {alarm.reminder}
                      </div>
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => deleteAlarm(alarm.id)}
                    className="p-2 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>

        {/* Footer Info */}
        <div className="text-center pt-8">
          <p className="text-[10px] text-zinc-400 uppercase tracking-[0.2em]">
            Powered by Gemini AI Voice Synthesis
          </p>
        </div>
      </div>
    </div>
  );
}
