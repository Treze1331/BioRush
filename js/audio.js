let audioContext = null;
let musicTimerId = null;

export function initAudio() {
  if (audioContext) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  audioContext = new AudioContextClass();
}

function playTone(frequency, duration = 0.16, type = "sine", volume = 0.12, delay = 0) {
  if (!audioContext) {
    return;
  }

  const startTime = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.03);
}

export function playStartSound() {
  playTone(440, 0.12, "triangle", 0.1);
  playTone(660, 0.16, "triangle", 0.1, 0.1);
}

export function playCorrectSound() {
  playTone(620, 0.12, "sine", 0.12);
  playTone(830, 0.18, "sine", 0.12, 0.1);
}

export function playWrongSound() {
  playTone(180, 0.2, "sawtooth", 0.08);
  playTone(130, 0.22, "sawtooth", 0.07, 0.13);
}

export function playTimeoutSound() {
  playTone(260, 0.18, "square", 0.08);
  playTone(220, 0.18, "square", 0.08, 0.18);
}

export function playTickSound() {
  playTone(720, 0.06, "square", 0.05);
}

export function playFinishSound() {
  playTone(520, 0.14, "triangle", 0.1);
  playTone(660, 0.14, "triangle", 0.1, 0.12);
  playTone(780, 0.24, "triangle", 0.1, 0.24);
}

export function startMusic() {
  if (!audioContext || musicTimerId !== null) {
    return;
  }

  const notes = [196, 247, 294, 247, 220, 262, 330, 262];
  let noteIndex = 0;

  musicTimerId = window.setInterval(() => {
    playTone(notes[noteIndex], 0.28, "triangle", 0.025);
    noteIndex = (noteIndex + 1) % notes.length;
  }, 520);
}

export function stopMusic() {
  if (musicTimerId !== null) {
    window.clearInterval(musicTimerId);
    musicTimerId = null;
  }
}
