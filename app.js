/* ====== Constantes ====== */
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const FREQ_MIN = 20;
const FREQ_MAX = 20000;

let audioCtx = null;
let oscillator = null;
let gainNode = null;
let pannerNode = null;
let analyserTime = null;
let analyserFreq = null;
let meterAnalyser = null;
let isPlaying = false;
let rafId = null;

const state = {
  waveform: "sine",
  frequency: 440,
  amplitude: 50,
  pan: 0
};

/* ====== Mapeo slider <-> frecuencia (logarítmico) ====== */
// slider 0-1000 -> 20-20000 Hz, escala logarítmica
function sliderToFreq(sliderVal) {
  const minLog = Math.log(FREQ_MIN);
  const maxLog = Math.log(FREQ_MAX);
  const scale = (maxLog - minLog) / 1000;
  return Math.exp(minLog + scale * sliderVal);
}

function freqToSlider(freq) {
  const minLog = Math.log(FREQ_MIN);
  const maxLog = Math.log(FREQ_MAX);
  const scale = (maxLog - minLog) / 1000;
  return (Math.log(freq) - minLog) / scale;
}

/* ====== Conversión frecuencia <-> nota musical ====== */
// A4 = 440 Hz = MIDI 69
function freqToNote(freq) {
  if (freq <= 0) return { name: "-", octave: "", cents: 0, midi: 0 };
  const midiFloat = 12 * Math.log2(freq / 440) + 69;
  const midiRounded = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midiRounded) * 100);
  const noteIndex = ((midiRounded % 12) + 12) % 12;
  const octave = Math.floor(midiRounded / 12) - 1;
  return {
    name: NOTE_NAMES[noteIndex],
    octave: octave,
    cents: cents,
    midi: midiRounded
  };
}

function noteToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* ====== Inicialización audio ====== */
function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function startTone() {
  ensureAudioContext();

  oscillator = audioCtx.createOscillator();
  gainNode = audioCtx.createGain();
  pannerNode = audioCtx.createStereoPanner();
  analyserTime = audioCtx.createAnalyser();
  analyserFreq = audioCtx.createAnalyser();
  meterAnalyser = audioCtx.createAnalyser();

  analyserTime.fftSize = 2048;
  analyserFreq.fftSize = 2048;
  meterAnalyser.fftSize = 1024;

  oscillator.type = state.waveform;
  oscillator.frequency.value = state.frequency;

  gainNode.gain.value = state.amplitude / 100;

  pannerNode.pan.value = state.pan / 100;

  oscillator.connect(gainNode);
  gainNode.connect(pannerNode);
  pannerNode.connect(analyserTime);
  pannerNode.connect(analyserFreq);
  pannerNode.connect(meterAnalyser);
  pannerNode.connect(audioCtx.destination);

  oscillator.start();
  isPlaying = true;

  startVisualLoop();
}

function stopTone() {
  if (oscillator) {
    try { oscillator.stop(); } catch (e) {}
    oscillator.disconnect();
    gainNode.disconnect();
    pannerNode.disconnect();
    oscillator = null;
  }
  isPlaying = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  clearCanvases();
}

/* ====== Actualización en vivo de parámetros ====== */
function updateOscillatorParams() {
  if (oscillator) {
    oscillator.type = state.waveform;
    oscillator.frequency.setValueAtTime(state.frequency, audioCtx.currentTime);
  }
  if (gainNode) {
    gainNode.gain.setValueAtTime(state.amplitude / 100, audioCtx.currentTime);
  }
  if (pannerNode) {
    pannerNode.pan.setValueAtTime(state.pan / 100, audioCtx.currentTime);
  }
}

/* ====== Canvas setup con soporte alta densidad ====== */
function setupCanvas(canvas) {
  // Fija la altura CSS desde el atributo HTML 'height' la primera vez,
  // para que el layout no dependa del tamaño interno del canvas
  // (evita colapso a 0px cuando el módulo está oculto al inicializar).
  if (!canvas.style.height) {
    const attrHeight = canvas.getAttribute("height");
    if (attrHeight) canvas.style.height = attrHeight + "px";
  }

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  return { ctx, width: rect.width, height: rect.height };
}

function clearCanvases() {
  ["oscilloscope", "spectrum", "meter"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
  document.getElementById("meter-reading").textContent = "-∞ dB";
  redrawCycleView();
}

function redrawCycleView() {
  const canvas = document.getElementById("cycle-view");
  const { ctx, width, height } = setupCanvas(canvas);
  drawCycleView(ctx, width, height);
}

function drawGrid(ctx, width, height) {
  ctx.strokeStyle = getCssVar("--grid-line");
  ctx.lineWidth = 1;
  const divisions = 8;
  for (let i = 1; i < divisions; i++) {
    const x = (width / divisions) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  const hDivisions = 4;
  for (let i = 1; i < hDivisions; i++) {
    const y = (height / hDivisions) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function getCssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

/* ====== Bucle de visualización ====== */
function startVisualLoop() {
  const oscCanvas = document.getElementById("oscilloscope");
  const cycleCanvas = document.getElementById("cycle-view");
  const fftCanvas = document.getElementById("spectrum");
  const meterCanvas = document.getElementById("meter");

  const oscSetup = setupCanvas(oscCanvas);
  const cycleSetup = setupCanvas(cycleCanvas);
  const fftSetup = setupCanvas(fftCanvas);
  const meterSetup = setupCanvas(meterCanvas);

  const timeData = new Uint8Array(analyserTime.fftSize);
  const freqData = new Uint8Array(analyserFreq.frequencyBinCount);
  const meterData = new Float32Array(meterAnalyser.fftSize);

  function draw() {
    if (!isPlaying) return;

    // Osciloscopio
    analyserTime.getByteTimeDomainData(timeData);
    drawOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, timeData);

    // Forma de onda ideal (1 periodo)
    drawCycleView(cycleSetup.ctx, cycleSetup.width, cycleSetup.height);

    // FFT
    analyserFreq.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);

    // Medidor de nivel
    meterAnalyser.getFloatTimeDomainData(meterData);
    drawMeter(meterSetup.ctx, meterSetup.width, meterSetup.height, meterData);

    rafId = requestAnimationFrame(draw);
  }

  draw();
}

function drawOscilloscope(ctx, width, height, data) {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  ctx.lineWidth = 2;
  ctx.strokeStyle = getCssVar("--wave-color");
  ctx.beginPath();

  const sliceWidth = width / data.length;
  let x = 0;

  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128.0;
    const y = (v * height) / 2;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    x += sliceWidth;
  }
  ctx.stroke();
}

function drawCycleView(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  const amplitude = state.amplitude / 100;
  const centerY = height / 2;
  const peakPx = (height / 2) * 0.8 * amplitude;

  ctx.lineWidth = 2;
  ctx.strokeStyle = getCssVar("--wave-color");
  ctx.beginPath();

  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const phase = i / steps; // 0..1 = un periodo completo
    const value = waveformValue(state.waveform, phase);
    const x = (i / steps) * width;
    const y = centerY - value * peakPx;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Linea de amplitud cero
  ctx.strokeStyle = getCssVar("--grid-line");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  const periodMs = (1 / state.frequency) * 1000;
  document.getElementById("cycle-reading").textContent = `T = ${periodMs.toFixed(2)} ms`;
}

// Valor normalizado (-1..1) de la forma de onda en una fase 0..1
function waveformValue(waveform, phase) {
  switch (waveform) {
    case "square":
      return phase < 0.5 ? 1 : -1;
    case "triangle":
      return phase < 0.5
        ? -1 + 4 * phase
        : 3 - 4 * phase;
    case "sawtooth":
      return -1 + 2 * phase;
    case "sine":
    default:
      return Math.sin(2 * Math.PI * phase);
  }
}

function drawSpectrum(ctx, width, height, data) {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  const barCount = data.length;
  const barWidth = width / barCount;

  ctx.fillStyle = getCssVar("--fft-color");

  for (let i = 0; i < barCount; i++) {
    const value = data[i] / 255;
    const barHeight = value * height;
    ctx.fillRect(i * barWidth, height - barHeight, Math.max(barWidth - 1, 1), barHeight);
  }
}

function drawMeter(ctx, width, height, data) {
  ctx.clearRect(0, 0, width, height);

  // RMS
  let sumSquares = 0;
  for (let i = 0; i < data.length; i++) {
    sumSquares += data[i] * data[i];
  }
  const rms = Math.sqrt(sumSquares / data.length);
  const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

  const minDb = -60;
  const clamped = Math.max(minDb, Math.min(0, db));
  const ratio = (clamped - minDb) / (0 - minDb);

  // background
  ctx.fillStyle = getCssVar("--track-bg");
  ctx.fillRect(0, 0, width, height);

  // barra vertical de abajo hacia arriba
  const barHeight = ratio * height;
  let color = getCssVar("--accent3");
  if (ratio > 0.85) color = getCssVar("--accent4");
  else if (ratio > 0.7) color = getCssVar("--accent2");

  ctx.fillStyle = color;
  ctx.fillRect(0, height - barHeight, width, barHeight);

  document.getElementById("meter-reading").textContent =
    db === -Infinity ? "-∞ dB" : `${db.toFixed(1)} dB`;
}

/* ====== Selector de nota + octava ====== */
const NOTE_SOLFEGE = {
  "C": "Do", "C#": "Do#", "D": "Re", "D#": "Re#", "E": "Mi",
  "F": "Fa", "F#": "Fa#", "G": "Sol", "G#": "Sol#", "A": "La",
  "A#": "La#", "B": "Si"
};
const OCTAVE_RANGE = [2, 3, 4, 5, 6];

function buildNoteSelector() {
  const noteGrid = document.getElementById("note-grid");
  noteGrid.innerHTML = "";
  NOTE_NAMES.forEach(name => {
    const btn = document.createElement("button");
    btn.className = "note-btn";
    btn.dataset.note = name;
    btn.innerHTML = `<span class="note-en">${name}</span><span class="note-solfege">${NOTE_SOLFEGE[name]}</span>`;
    btn.addEventListener("click", () => setFrequencyFromNoteOctave(name, getSelectedOctave()));
    noteGrid.appendChild(btn);
  });

  const octaveButtons = document.getElementById("octave-buttons");
  octaveButtons.innerHTML = "";
  OCTAVE_RANGE.forEach(oct => {
    const btn = document.createElement("button");
    btn.className = "octave-btn";
    btn.dataset.octave = oct;
    btn.textContent = oct;
    btn.addEventListener("click", () => setFrequencyFromNoteOctave(getSelectedNote(), oct));
    octaveButtons.appendChild(btn);
  });
}

function getSelectedNote() {
  const active = document.querySelector(".note-btn.active");
  return active ? active.dataset.note : "A";
}

function getSelectedOctave() {
  const active = document.querySelector(".octave-btn.active");
  return active ? parseInt(active.dataset.octave) : 4;
}

function noteOctaveToMidi(name, octave) {
  const noteIndex = NOTE_NAMES.indexOf(name);
  return (octave + 1) * 12 + noteIndex;
}

function setFrequencyFromNoteOctave(name, octave) {
  const midi = noteOctaveToMidi(name, octave);
  const freq = noteToFreq(midi);
  state.frequency = freq;
  document.getElementById("freq-slider").value = Math.round(freqToSlider(freq));
  updateFrequencyDisplay();
  updateOscillatorParams();
  redrawCycleView();
}

function highlightNoteSelector(noteName, octave) {
  document.querySelectorAll(".note-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.note === noteName);
  });
  document.querySelectorAll(".octave-btn").forEach(b => {
    b.classList.toggle("active", parseInt(b.dataset.octave) === octave);
  });
}

/* ====== Actualización de UI ====== */
function updateFrequencyDisplay() {
  const freq = state.frequency;
  document.getElementById("freq-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById("note-name").textContent = `${note.name}${note.octave} — ${solfege}`;

  const centsSign = note.cents >= 0 ? "+" : "";
  document.getElementById("note-cents").textContent = `${centsSign}${note.cents} cents`;

  highlightNoteSelector(note.name, note.octave);
}

function updateAmplitudeDisplay() {
  const amp = state.amplitude;
  document.getElementById("amp-value").textContent = amp;
  const db = amp > 0 ? (20 * Math.log10(amp / 100)).toFixed(1) : "-Inf";
  document.getElementById("amp-db").textContent = `${db} dBFS`;
}

function updatePanDisplay() {
  const pan = state.pan;
  document.getElementById("pan-value").textContent = pan;
}

/* ====== Listeners ====== */
function initControls() {
  // Forma de onda
  document.querySelectorAll("#module-generator .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#module-generator .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.waveform = btn.dataset.wave;
      updateOscillatorParams();
      redrawCycleView();
    });
  });

  // Frecuencia
  const freqSlider = document.getElementById("freq-slider");
  freqSlider.addEventListener("input", () => {
    state.frequency = sliderToFreq(parseFloat(freqSlider.value));
    updateFrequencyDisplay();
    updateOscillatorParams();
    redrawCycleView();
  });

  // Amplitud
  const ampSlider = document.getElementById("amp-slider");
  ampSlider.addEventListener("input", () => {
    state.amplitude = parseFloat(ampSlider.value);
    updateAmplitudeDisplay();
    updateOscillatorParams();
    redrawCycleView();
  });

  // Pan (con snap-to-zero magnético)
  const panSlider = document.getElementById("pan-slider");
  const PAN_SNAP_THRESHOLD = 4;
  panSlider.addEventListener("input", () => {
    let value = parseFloat(panSlider.value);
    if (Math.abs(value) <= PAN_SNAP_THRESHOLD) {
      value = 0;
      panSlider.value = "0";
    }
    state.pan = value;
    updatePanDisplay();
    updateOscillatorParams();
  });

  // Play/Stop
  const playBtn = document.getElementById("play-btn");
  playBtn.addEventListener("click", () => {
    if (!isPlaying) {
      startTone();
      playBtn.classList.add("playing");
      document.getElementById("play-icon").innerHTML = "&#9632;";
      document.getElementById("play-label").textContent = t("stop");
    } else {
      stopTone();
      playBtn.classList.remove("playing");
      document.getElementById("play-icon").innerHTML = "&#9658;";
      document.getElementById("play-label").textContent = t("generate");
    }
  });

  // Tema claro/oscuro
  const themeToggle = document.getElementById("theme-toggle");
  themeToggle.addEventListener("click", () => {
    const root = document.documentElement;
    const current = root.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    document.getElementById("theme-icon").innerHTML = next === "dark" ? "&#9789;" : "&#9728;";
    if (isPlaying) {
      // redraw grid colors immediately
    }
  });

  // Idioma
  document.querySelectorAll("#lang-switch button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#lang-switch button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      applyTranslations(btn.dataset.lang);
      if (isPlaying) {
        const playBtn = document.getElementById("play-btn");
        document.getElementById("play-label").textContent = t("stop");
      }
      // Re-aplicar textos con interpolacion que applyTranslations sobrescribe
      samplingUpdateNyquistHint();
      samplingUpdateBitDepthDisplay();
    });
  });

  // Resize handling
  window.addEventListener("resize", () => {
    if (!isPlaying) {
      clearCanvases();
    }
    if (dualIsPlaying) {
      dualClearCanvases();
    }
    if (modIsPlaying) {
      modClearCanvases();
    }
    if (noiseIsPlaying || sweepIsPlaying) {
      noiseClearCanvases();
    }
    if (filterIsPlaying) {
      filterClearCanvases();
    }
    if (samplingIsPlaying) {
      samplingClearCanvases();
    }
    if (stereoIsPlaying) {
      stereoClearCanvases();
    }
    if (dubIsPlaying) {
      dubClearCanvases();
    }
    if (rackIsPlaying) {
      rackClearCanvases();
    }
    if (smpVisualRunning) {
      smpClearCanvases();
    }
  });

  // Cambio de módulo (tabs)
  document.querySelectorAll(".module-tab").forEach(tab => {
    if (tab.classList.contains("disabled")) return;
    tab.addEventListener("click", () => {
      const target = tab.dataset.module;
      document.querySelectorAll(".module-tab").forEach(t => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".module-view").forEach(view => {
        view.hidden = view.id !== `module-${target}`;
      });

      // Detener audio del modulo que se abandona
      if (target !== "generator" && isPlaying) {
        stopTone();
        document.getElementById("play-btn").classList.remove("playing");
        document.getElementById("play-icon").innerHTML = "&#9658;";
        document.getElementById("play-label").textContent = t("generate");
      }
      if (target !== "dual" && dualIsPlaying) {
        dualStopTone();
        document.getElementById("dual-play-btn").classList.remove("playing");
        document.getElementById("dual-play-icon").innerHTML = "&#9658;";
        document.getElementById("dual-play-label").textContent = t("generate");
      }
      if (target !== "modulation" && modIsPlaying) {
        modStopTone();
        document.getElementById("mod-play-btn").classList.remove("playing");
        document.getElementById("mod-play-icon").innerHTML = "&#9658;";
        document.getElementById("mod-play-label").textContent = t("hold_to_play");
      }
      if (target !== "noise") {
        if (noiseIsPlaying) {
          noiseStopTone();
          document.getElementById("noise-play-btn").classList.remove("playing");
          document.getElementById("noise-play-icon").innerHTML = "&#9658;";
          document.getElementById("noise-play-label").textContent = t("generate");
        }
        if (sweepIsPlaying) {
          sweepStopTone();
          document.getElementById("sweep-play-btn").classList.remove("playing");
          document.getElementById("sweep-play-icon").innerHTML = "&#9658;";
          document.getElementById("sweep-play-label").textContent = t("generate");
        }
      }
      if (target !== "filters" && filterIsPlaying) {
        filterStopTone();
        document.getElementById("filter-play-btn").classList.remove("playing");
        document.getElementById("filter-play-icon").innerHTML = "&#9658;";
        document.getElementById("filter-play-label").textContent = t("generate");
      }
      if (target !== "sampling" && samplingIsPlaying) {
        samplingStopTone();
        document.getElementById("sampling-play-btn").classList.remove("playing");
        document.getElementById("sampling-play-icon").innerHTML = "&#9658;";
        document.getElementById("sampling-play-label").textContent = t("generate");
      }
      if (target !== "stereo" && stereoIsPlaying) {
        stereoStopTone();
        document.getElementById("stereo-play-btn").classList.remove("playing");
        document.getElementById("stereo-play-icon").innerHTML = "&#9658;";
        document.getElementById("stereo-play-label").textContent = t("generate");
      }
      if (target !== "dubsiren" && dubIsPlaying) {
        dubStopTone();
      }
      if (target !== "rack" && rackIsPlaying) {
        rackStop();
      }
      if (target !== "sampler") {
        smpOnLeave();
      }

      if (target === "dual") {
        setTimeout(() => dualClearCanvases(), 50);
      } else if (target === "modulation") {
        setTimeout(() => modClearCanvases(), 50);
      } else if (target === "noise") {
        setTimeout(() => noiseClearCanvases(), 50);
      } else if (target === "filters") {
        setTimeout(() => filterClearCanvases(), 50);
      } else if (target === "sampling") {
        setTimeout(() => samplingClearCanvases(), 50);
      } else if (target === "stereo") {
        setTimeout(() => stereoClearCanvases(), 50);
      } else if (target === "dubsiren") {
        setTimeout(() => dubClearCanvases(), 50);
      } else if (target === "rack") {
        setTimeout(() => rackClearCanvases(), 50);
      } else if (target === "sampler") {
        setTimeout(() => smpClearCanvases(), 50);
      } else if (target === "generator" && !isPlaying) {
        setTimeout(() => clearCanvases(), 50);
      }
    });
  });
}

/* ====== Init ====== */
function init() {
  applyTranslations("es");
  buildNoteSelector();
  initControls();

  // Set initial slider position to 440 Hz
  document.getElementById("freq-slider").value = Math.round(freqToSlider(440));
  updateFrequencyDisplay();
  updateAmplitudeDisplay();
  updatePanDisplay();

  // Draw empty grids initially
  setTimeout(() => clearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", init);

/* ====================================================== */
/* ====== MÓDULO: DOS OSCILADORES (batido / fase) ====== */
/* ====================================================== */

let dualAudioCtx = null;
let dualOscA = null, dualOscB = null;
let dualGainA = null, dualGainB = null;
let dualMixGain = null;
let dualAnalyserA = null, dualAnalyserB = null, dualAnalyserSum = null, dualAnalyserFreq = null;
let dualIsPlaying = false;
let dualRafId = null;
let dualBeatInterval = null;

const dualState = {
  a: { waveform: "sine", frequency: 440, amplitude: 50 },
  b: { waveform: "sine", frequency: 440, amplitude: 50 },
  phase: 0
};

function dualEnsureAudioContext() {
  if (!dualAudioCtx) {
    dualAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (dualAudioCtx.state === "suspended") {
    dualAudioCtx.resume();
  }
}

// Calcula el delay (segundos) que produce el desfase deseado para osc B
function dualPhaseDelay() {
  const period = 1 / dualState.b.frequency;
  return (dualState.phase / 360) * period;
}

function dualStartTone() {
  dualEnsureAudioContext();

  dualOscA = dualAudioCtx.createOscillator();
  dualOscB = dualAudioCtx.createOscillator();
  dualGainA = dualAudioCtx.createGain();
  dualGainB = dualAudioCtx.createGain();
  dualMixGain = dualAudioCtx.createGain();
  dualAnalyserA = dualAudioCtx.createAnalyser();
  dualAnalyserB = dualAudioCtx.createAnalyser();
  dualAnalyserSum = dualAudioCtx.createAnalyser();
  dualAnalyserFreq = dualAudioCtx.createAnalyser();

  [dualAnalyserA, dualAnalyserB, dualAnalyserSum].forEach(a => a.fftSize = 2048);
  dualAnalyserFreq.fftSize = 2048;

  dualOscA.type = dualState.a.waveform;
  dualOscA.frequency.value = dualState.a.frequency;
  dualOscB.type = dualState.b.waveform;
  dualOscB.frequency.value = dualState.b.frequency;

  dualGainA.gain.value = dualState.a.amplitude / 100;
  dualGainB.gain.value = dualState.b.amplitude / 100;
  dualMixGain.gain.value = 0.5; // evita clipping al sumar A+B

  dualOscA.connect(dualGainA);
  dualOscB.connect(dualGainB);

  dualGainA.connect(dualAnalyserA);
  dualGainB.connect(dualAnalyserB);

  dualGainA.connect(dualMixGain);
  dualGainB.connect(dualMixGain);

  dualMixGain.connect(dualAnalyserSum);
  dualMixGain.connect(dualAnalyserFreq);
  dualMixGain.connect(dualAudioCtx.destination);

  const now = dualAudioCtx.currentTime;
  dualOscA.start(now);
  // Desfase de B mediante retardo de inicio
  const delay = dualPhaseDelay();
  dualOscB.start(now + delay);

  dualIsPlaying = true;
  dualStartVisualLoop();
  dualStartBeatPulse();
}

function dualStopTone() {
  [dualOscA, dualOscB].forEach(osc => {
    if (osc) { try { osc.stop(); } catch (e) {} osc.disconnect(); }
  });
  [dualGainA, dualGainB, dualMixGain].forEach(g => { if (g) g.disconnect(); });
  dualOscA = dualOscB = dualGainA = dualGainB = dualMixGain = null;

  dualIsPlaying = false;
  if (dualRafId) {
    cancelAnimationFrame(dualRafId);
    dualRafId = null;
  }
  if (dualBeatInterval) {
    clearTimeout(dualBeatInterval);
    dualBeatInterval = null;
  }
  document.getElementById("beat-pulse").classList.remove("active");
  dualClearCanvases();
}

// Reinicia los osciladores para aplicar cambios que no se pueden actualizar en vivo
// (forma de onda y fase requieren recrear el nodo en Web Audio para fase; forma de onda sí es en vivo)
function dualUpdateLiveParams() {
  if (dualOscA) {
    dualOscA.type = dualState.a.waveform;
    dualOscA.frequency.setValueAtTime(dualState.a.frequency, dualAudioCtx.currentTime);
  }
  if (dualOscB) {
    dualOscB.type = dualState.b.waveform;
    dualOscB.frequency.setValueAtTime(dualState.b.frequency, dualAudioCtx.currentTime);
  }
  if (dualGainA) dualGainA.gain.setValueAtTime(dualState.a.amplitude / 100, dualAudioCtx.currentTime);
  if (dualGainB) dualGainB.gain.setValueAtTime(dualState.b.amplitude / 100, dualAudioCtx.currentTime);
}

// La fase relativa requiere reiniciar B con un nuevo retardo de inicio
function dualRestartForPhaseChange() {
  if (!dualIsPlaying) return;
  dualStopTone();
  dualStartTone();
}

/* ====== Visualización ====== */
function dualClearCanvases() {
  ["dual-oscilloscope", "dual-spectrum"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
  document.getElementById("beat-freq-value").textContent = "0.00 Hz";
}

function dualStartVisualLoop() {
  const oscCanvas = document.getElementById("dual-oscilloscope");
  const fftCanvas = document.getElementById("dual-spectrum");

  const oscSetup = setupCanvas(oscCanvas);
  const fftSetup = setupCanvas(fftCanvas);

  const dataA = new Uint8Array(dualAnalyserA.fftSize);
  const dataB = new Uint8Array(dualAnalyserB.fftSize);
  const dataSum = new Uint8Array(dualAnalyserSum.fftSize);
  const freqData = new Uint8Array(dualAnalyserFreq.frequencyBinCount);

  function draw() {
    if (!dualIsPlaying) return;

    dualAnalyserA.getByteTimeDomainData(dataA);
    dualAnalyserB.getByteTimeDomainData(dataB);
    dualAnalyserSum.getByteTimeDomainData(dataSum);
    drawDualOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, dataA, dataB, dataSum);

    dualAnalyserFreq.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);

    dualRafId = requestAnimationFrame(draw);
  }

  draw();
}

function dualDrawTrace(ctx, width, height, data, color) {
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.beginPath();
  const sliceWidth = width / data.length;
  let x = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128.0;
    const y = (v * height) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.stroke();
}

function drawDualOscilloscope(ctx, width, height, dataA, dataB, dataSum) {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  dualDrawTrace(ctx, width, height, dataA, getCssVar("--wave-color"));
  dualDrawTrace(ctx, width, height, dataB, getCssVar("--accent2"));
  dualDrawTrace(ctx, width, height, dataSum, getCssVar("--accent3"));
}

/* ====== Frecuencia de batido y pulso visual ====== */
function dualUpdateBeatFrequency() {
  const beat = Math.abs(dualState.a.frequency - dualState.b.frequency);
  document.getElementById("beat-freq-value").textContent = `${beat.toFixed(2)} Hz`;
  return beat;
}

function dualStartBeatPulse() {
  if (dualBeatInterval) clearTimeout(dualBeatInterval);
  const pulse = document.getElementById("beat-pulse");

  function schedule() {
    const beat = dualUpdateBeatFrequency();
    if (!dualIsPlaying) return;

    if (beat < 0.5 || beat > 20) {
      // batido demasiado lento o demasiado rapido para pulso visual util
      pulse.classList.remove("active");
      dualBeatInterval = setTimeout(schedule, 500);
      return;
    }

    const periodMs = (1 / beat) * 1000;
    pulse.classList.add("active");
    dualBeatInterval = setTimeout(() => {
      pulse.classList.remove("active");
      dualBeatInterval = setTimeout(schedule, periodMs / 2);
    }, periodMs / 2);
  }

  schedule();
}

/* ====== UI: displays ====== */
function dualUpdateFreqDisplay(osc) {
  const freq = dualState[osc].frequency;
  const valueEl = document.getElementById(`dual-${osc}-freq-value`);
  valueEl.textContent = freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById(`dual-${osc}-note`).textContent = `${note.name}${note.octave} — ${solfege}`;

  dualUpdateBeatFrequency();
}

function dualUpdateAmpDisplay(osc) {
  document.getElementById(`dual-${osc}-amp-value`).textContent = dualState[osc].amplitude;
}

/* ====== Listeners del módulo ====== */
function initDualControls() {
  // Forma de onda A y B
  ["a", "b"].forEach(osc => {
    document.querySelectorAll(`#dual-${osc}-waveform-grid .wave-btn`).forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(`#dual-${osc}-waveform-grid .wave-btn`).forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        dualState[osc].waveform = btn.dataset.wave;
        dualUpdateLiveParams();
      });
    });

    // Frecuencia
    const freqSlider = document.getElementById(`dual-${osc}-freq-slider`);
    freqSlider.addEventListener("input", () => {
      dualState[osc].frequency = sliderToFreq(parseFloat(freqSlider.value));
      dualUpdateFreqDisplay(osc);
      dualUpdateLiveParams();
    });

    // Amplitud
    const ampSlider = document.getElementById(`dual-${osc}-amp-slider`);
    ampSlider.addEventListener("input", () => {
      dualState[osc].amplitude = parseFloat(ampSlider.value);
      dualUpdateAmpDisplay(osc);
      dualUpdateLiveParams();
    });
  });

  // Fase relativa de B
  const phaseSlider = document.getElementById("dual-phase-slider");
  phaseSlider.addEventListener("input", () => {
    dualState.phase = parseFloat(phaseSlider.value);
    document.getElementById("dual-phase-value").textContent = dualState.phase;
  });
  phaseSlider.addEventListener("change", () => {
    dualRestartForPhaseChange();
  });

  // Preajuste de batido
  document.getElementById("beat-preset-btn").addEventListener("click", () => {
    dualState.a.frequency = 440;
    dualState.b.frequency = 444;
    dualState.phase = 0;

    document.getElementById("dual-a-freq-slider").value = Math.round(freqToSlider(440));
    document.getElementById("dual-b-freq-slider").value = Math.round(freqToSlider(444));
    document.getElementById("dual-phase-slider").value = 0;
    document.getElementById("dual-phase-value").textContent = "0";

    dualUpdateFreqDisplay("a");
    dualUpdateFreqDisplay("b");

    if (dualIsPlaying) {
      dualUpdateLiveParams();
      dualRestartForPhaseChange();
    }
  });

  // Play/Stop
  const dualPlayBtn = document.getElementById("dual-play-btn");
  dualPlayBtn.addEventListener("click", () => {
    if (!dualIsPlaying) {
      dualStartTone();
      dualPlayBtn.classList.add("playing");
      document.getElementById("dual-play-icon").innerHTML = "&#9632;";
      document.getElementById("dual-play-label").textContent = t("stop");
    } else {
      dualStopTone();
      dualPlayBtn.classList.remove("playing");
      document.getElementById("dual-play-icon").innerHTML = "&#9658;";
      document.getElementById("dual-play-label").textContent = t("generate");
    }
  });
}

/* ====== Init del módulo dual ====== */
function dualInit() {
  initDualControls();

  document.getElementById("dual-a-freq-slider").value = Math.round(freqToSlider(440));
  document.getElementById("dual-b-freq-slider").value = Math.round(freqToSlider(440));
  dualUpdateFreqDisplay("a");
  dualUpdateFreqDisplay("b");
  dualUpdateAmpDisplay("a");
  dualUpdateAmpDisplay("b");

  setTimeout(() => dualClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", dualInit);

/* ====================================================== */
/* ====== MÓDULO: MODULACIÓN (ADSR / tremolo / vibrato) === */
/* ====================================================== */

let modAudioCtx = null;
let modOsc = null;
let modAmpGain = null;        // controlado por la envolvente ADSR
let modTremoloGain = null;    // multiplica la señal (tremolo)
let modTremoloLFO = null;
let modTremoloLFOGain = null;
let modVibratoLFO = null;
let modVibratoLFOGain = null;
let modAnalyserTime = null;
let modAnalyserFreq = null;
let modIsPlaying = false;
let modRafId = null;
let modReleaseTimeout = null;

const modState = {
  waveform: "sine",
  frequency: 440,
  amplitude: 50,
  adsr: { attack: 0.05, decay: 0.10, sustain: 0.70, release: 0.30 },
  tremolo: { enabled: false, rate: 5, depth: 50 },
  vibrato: { enabled: false, rate: 5, depth: 20 }
};

function modEnsureAudioContext() {
  if (!modAudioCtx) {
    modAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (modAudioCtx.state === "suspended") {
    modAudioCtx.resume();
  }
}

function modStartTone() {
  modEnsureAudioContext();
  if (modReleaseTimeout) {
    clearTimeout(modReleaseTimeout);
    modReleaseTimeout = null;
  }

  modOsc = modAudioCtx.createOscillator();
  modAmpGain = modAudioCtx.createGain();
  modTremoloGain = modAudioCtx.createGain();
  modAnalyserTime = modAudioCtx.createAnalyser();
  modAnalyserFreq = modAudioCtx.createAnalyser();

  modAnalyserTime.fftSize = 2048;
  modAnalyserFreq.fftSize = 2048;

  modOsc.type = modState.waveform;
  modOsc.frequency.value = modState.frequency;

  const peakGain = modState.amplitude / 100;
  modAmpGain.gain.value = 0;
  modTremoloGain.gain.value = 1;

  modOsc.connect(modAmpGain);
  modAmpGain.connect(modTremoloGain);
  modTremoloGain.connect(modAnalyserTime);
  modTremoloGain.connect(modAnalyserFreq);
  modTremoloGain.connect(modAudioCtx.destination);

  const now = modAudioCtx.currentTime;
  modOsc.start(now);

  // Envolvente ADSR: Attack -> Decay -> Sustain (mantenido hasta Release)
  const { attack, decay, sustain } = modState.adsr;
  modAmpGain.gain.setValueAtTime(0, now);
  modAmpGain.gain.linearRampToValueAtTime(peakGain, now + attack);
  modAmpGain.gain.linearRampToValueAtTime(peakGain * sustain, now + attack + decay);

  // Vibrato: LFO sumado a la frecuencia del oscilador principal
  if (modState.vibrato.enabled) {
    modVibratoLFO = modAudioCtx.createOscillator();
    modVibratoLFOGain = modAudioCtx.createGain();
    modVibratoLFO.type = "sine";
    modVibratoLFO.frequency.value = modState.vibrato.rate;
    modVibratoLFOGain.gain.value = modState.vibrato.depth;
    modVibratoLFO.connect(modVibratoLFOGain);
    modVibratoLFOGain.connect(modOsc.frequency);
    modVibratoLFO.start(now);
  }

  // Tremolo: LFO que modula la ganancia de salida entre (1-depth) y 1
  if (modState.tremolo.enabled) {
    modTremoloLFO = modAudioCtx.createOscillator();
    modTremoloLFOGain = modAudioCtx.createGain();
    modTremoloLFO.type = "sine";
    modTremoloLFO.frequency.value = modState.tremolo.rate;
    const depthRatio = modState.tremolo.depth / 100;
    // LFO oscila -depth/2 .. +depth/2 alrededor de 0
    modTremoloLFOGain.gain.value = depthRatio / 2;
    modTremoloGain.gain.value = 1 - depthRatio / 2;
    modTremoloLFO.connect(modTremoloLFOGain);
    modTremoloLFOGain.connect(modTremoloGain.gain);
    modTremoloLFO.start(now);
  }

  modIsPlaying = true;
  modStartVisualLoop();
}

function modStopTone() {
  if (!modOsc) return;

  const now = modAudioCtx.currentTime;
  const { release } = modState.adsr;
  const currentGain = modAmpGain.gain.value;

  // Aplica Release y luego detiene los nodos
  modAmpGain.gain.cancelScheduledValues(now);
  modAmpGain.gain.setValueAtTime(currentGain, now);
  modAmpGain.gain.linearRampToValueAtTime(0, now + release);

  const oscToStop = modOsc;
  const vibratoToStop = modVibratoLFO;
  const tremoloToStop = modTremoloLFO;
  const nodesToDisconnect = [modAmpGain, modTremoloGain, modVibratoLFOGain, modTremoloLFOGain];

  modReleaseTimeout = setTimeout(() => {
    try { oscToStop.stop(); } catch (e) {}
    if (vibratoToStop) try { vibratoToStop.stop(); } catch (e) {}
    if (tremoloToStop) try { tremoloToStop.stop(); } catch (e) {}
    nodesToDisconnect.forEach(n => { if (n) try { n.disconnect(); } catch (e) {} });
    oscToStop.disconnect();
    modReleaseTimeout = null;
  }, release * 1000 + 50);

  modOsc = modAmpGain = modTremoloGain = null;
  modVibratoLFO = modVibratoLFOGain = null;
  modTremoloLFO = modTremoloLFOGain = null;

  modIsPlaying = false;
  if (modRafId) {
    cancelAnimationFrame(modRafId);
    modRafId = null;
  }
  modClearCanvases();
}

/* ====== Visualización ====== */
function modClearCanvases() {
  ["adsr-envelope", "mod-oscilloscope", "mod-spectrum"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
  modRedrawEnvelope();
}

function modStartVisualLoop() {
  const oscCanvas = document.getElementById("mod-oscilloscope");
  const fftCanvas = document.getElementById("mod-spectrum");

  const oscSetup = setupCanvas(oscCanvas);
  const fftSetup = setupCanvas(fftCanvas);

  const timeData = new Uint8Array(modAnalyserTime.fftSize);
  const freqData = new Uint8Array(modAnalyserFreq.frequencyBinCount);

  function draw() {
    if (!modIsPlaying) return;

    modAnalyserTime.getByteTimeDomainData(timeData);
    drawOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, timeData);

    modAnalyserFreq.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);

    modRafId = requestAnimationFrame(draw);
  }

  draw();
}

// Dibuja la curva ADSR de forma esquemática (Attack-Decay-Sustain-Release)
// con los tiempos a escala relativa entre si
function modRedrawEnvelope() {
  const canvas = document.getElementById("adsr-envelope");
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  const { attack, decay, sustain, release } = modState.adsr;
  const sustainHold = Math.max(attack, decay, release, 0.1); // duracion visual del tramo sustain
  const total = attack + decay + sustainHold + release;

  const padding = 8;
  const usableHeight = height - padding * 2;
  const peakY = padding;
  const sustainY = padding + usableHeight * (1 - sustain);
  const baseY = height - padding;

  const xAttack = (attack / total) * width;
  const xDecay = xAttack + (decay / total) * width;
  const xSustain = xDecay + (sustainHold / total) * width;
  const xRelease = width;

  ctx.lineWidth = 2;
  ctx.strokeStyle = getCssVar("--wave-color");
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  ctx.lineTo(xAttack, peakY);
  ctx.lineTo(xDecay, sustainY);
  ctx.lineTo(xSustain, sustainY);
  ctx.lineTo(xRelease, baseY);
  ctx.stroke();

  // Marcadores verticales en los puntos de transicion
  ctx.strokeStyle = getCssVar("--grid-line");
  ctx.lineWidth = 1;
  [xAttack, xDecay, xSustain].forEach(x => {
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, height - padding);
    ctx.stroke();
  });

  const totalReal = attack + decay + release;
  document.getElementById("adsr-total-reading").textContent =
    `A+D+R = ${totalReal.toFixed(2)} s`;
}

/* ====== UI: displays ====== */
function modUpdateFreqDisplay() {
  const freq = modState.frequency;
  document.getElementById("mod-freq-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById("mod-note").textContent = `${note.name}${note.octave} — ${solfege}`;
}

function modUpdateAmpDisplay() {
  document.getElementById("mod-amp-value").textContent = modState.amplitude;
}

// sliders ADSR: attack/decay/release usan escala 1-2000/3000 (ms), sustain en %
function modUpdateAdsrDisplay() {
  document.getElementById("adsr-attack-value").textContent = modState.adsr.attack.toFixed(2);
  document.getElementById("adsr-decay-value").textContent = modState.adsr.decay.toFixed(2);
  document.getElementById("adsr-sustain-value").textContent = Math.round(modState.adsr.sustain * 100);
  document.getElementById("adsr-release-value").textContent = modState.adsr.release.toFixed(2);
  modRedrawEnvelope();
}

function modUpdateTremoloDisplay() {
  document.getElementById("tremolo-rate-value").textContent = modState.tremolo.rate.toFixed(1);
  document.getElementById("tremolo-depth-value").textContent = modState.tremolo.depth;
}

function modUpdateVibratoDisplay() {
  document.getElementById("vibrato-rate-value").textContent = modState.vibrato.rate.toFixed(1);
  document.getElementById("vibrato-depth-value").textContent = modState.vibrato.depth;
}

/* ====== Listeners del módulo ====== */
function initModControls() {
  // Forma de onda
  document.querySelectorAll("#mod-waveform-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#mod-waveform-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      modState.waveform = btn.dataset.wave;
      if (modOsc) modOsc.type = modState.waveform;
    });
  });

  // Frecuencia
  const freqSlider = document.getElementById("mod-freq-slider");
  freqSlider.addEventListener("input", () => {
    modState.frequency = sliderToFreq(parseFloat(freqSlider.value));
    modUpdateFreqDisplay();
    if (modOsc) modOsc.frequency.setValueAtTime(modState.frequency, modAudioCtx.currentTime);
  });

  // Amplitud (en vivo: reescala el gain actual manteniendo la fase ADSR)
  const ampSlider = document.getElementById("mod-amp-slider");
  ampSlider.addEventListener("input", () => {
    const oldAmplitude = modState.amplitude;
    modState.amplitude = parseFloat(ampSlider.value);
    modUpdateAmpDisplay();

    if (modAmpGain && oldAmplitude > 0) {
      const ratio = modState.amplitude / oldAmplitude;
      const newGain = modAmpGain.gain.value * ratio;
      modAmpGain.gain.setValueAtTime(newGain, modAudioCtx.currentTime);
    }
  });

  // ADSR sliders (escala: attack/decay en ms 1-2000 -> 0.001-2.0 s, release 1-3000 -> 0.001-3.0 s)
  const attackSlider = document.getElementById("adsr-attack-slider");
  attackSlider.addEventListener("input", () => {
    modState.adsr.attack = parseFloat(attackSlider.value) / 1000;
    modUpdateAdsrDisplay();
  });

  const decaySlider = document.getElementById("adsr-decay-slider");
  decaySlider.addEventListener("input", () => {
    modState.adsr.decay = parseFloat(decaySlider.value) / 1000;
    modUpdateAdsrDisplay();
  });

  const sustainSlider = document.getElementById("adsr-sustain-slider");
  sustainSlider.addEventListener("input", () => {
    modState.adsr.sustain = parseFloat(sustainSlider.value) / 100;
    modUpdateAdsrDisplay();
  });

  const releaseSlider = document.getElementById("adsr-release-slider");
  releaseSlider.addEventListener("input", () => {
    modState.adsr.release = parseFloat(releaseSlider.value) / 1000;
    modUpdateAdsrDisplay();
  });

  // Tremolo
  const tremoloEnable = document.getElementById("tremolo-enable");
  tremoloEnable.addEventListener("change", () => {
    modState.tremolo.enabled = tremoloEnable.checked;
  });

  const tremoloRate = document.getElementById("tremolo-rate-slider");
  tremoloRate.addEventListener("input", () => {
    modState.tremolo.rate = parseFloat(tremoloRate.value) / 10;
    modUpdateTremoloDisplay();
    if (modTremoloLFO) modTremoloLFO.frequency.setValueAtTime(modState.tremolo.rate, modAudioCtx.currentTime);
  });

  const tremoloDepth = document.getElementById("tremolo-depth-slider");
  tremoloDepth.addEventListener("input", () => {
    modState.tremolo.depth = parseFloat(tremoloDepth.value);
    modUpdateTremoloDisplay();
    if (modTremoloLFOGain) {
      const depthRatio = modState.tremolo.depth / 100;
      modTremoloLFOGain.gain.setValueAtTime(depthRatio / 2, modAudioCtx.currentTime);
      modTremoloGain.gain.setValueAtTime(1 - depthRatio / 2, modAudioCtx.currentTime);
    }
  });

  // Vibrato
  const vibratoEnable = document.getElementById("vibrato-enable");
  vibratoEnable.addEventListener("change", () => {
    modState.vibrato.enabled = vibratoEnable.checked;
  });

  const vibratoRate = document.getElementById("vibrato-rate-slider");
  vibratoRate.addEventListener("input", () => {
    modState.vibrato.rate = parseFloat(vibratoRate.value) / 10;
    modUpdateVibratoDisplay();
    if (modVibratoLFO) modVibratoLFO.frequency.setValueAtTime(modState.vibrato.rate, modAudioCtx.currentTime);
  });

  const vibratoDepth = document.getElementById("vibrato-depth-slider");
  vibratoDepth.addEventListener("input", () => {
    modState.vibrato.depth = parseFloat(vibratoDepth.value);
    modUpdateVibratoDisplay();
    if (modVibratoLFOGain) modVibratoLFOGain.gain.setValueAtTime(modState.vibrato.depth, modAudioCtx.currentTime);
  });

  // Tecla: mantener pulsado dispara Attack-Decay-Sustain, soltar dispara Release
  const modPlayBtn = document.getElementById("mod-play-btn");

  const modPress = (e) => {
    e.preventDefault();
    if (modIsPlaying) return;
    modStartTone();
    modPlayBtn.classList.add("playing");
    document.getElementById("mod-play-icon").innerHTML = "&#9655;";
    document.getElementById("mod-play-label").textContent = t("playing_note");
  };

  const modRelease = (e) => {
    if (!modIsPlaying) return;
    modStopTone();
    modPlayBtn.classList.remove("playing");
    document.getElementById("mod-play-icon").innerHTML = "&#9658;";
    document.getElementById("mod-play-label").textContent = t("hold_to_play");
  };

  modPlayBtn.addEventListener("pointerdown", modPress);
  modPlayBtn.addEventListener("pointerup", modRelease);
  modPlayBtn.addEventListener("pointerleave", modRelease);
  modPlayBtn.addEventListener("pointercancel", modRelease);
}

/* ====== Init del módulo modulación ====== */
function modInit() {
  initModControls();

  document.getElementById("mod-freq-slider").value = Math.round(freqToSlider(440));
  modUpdateFreqDisplay();
  modUpdateAmpDisplay();
  modUpdateAdsrDisplay();
  modUpdateTremoloDisplay();
  modUpdateVibratoDisplay();

  setTimeout(() => modClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", modInit);

/* ====================================================== */
/* ====== MÓDULO: RUIDO Y BARRIDOS ====================== */
/* ====================================================== */

let noiseAudioCtx = null;
let noiseSource = null;
let noiseGain = null;
let noiseAnalyserTime = null;
let noiseAnalyserFreq = null;
let noiseIsPlaying = false;

let sweepOsc = null;
let sweepGain = null;
let sweepAnalyserTime = null;
let sweepAnalyserFreq = null;
let sweepIsPlaying = false;
let sweepRafId = null;
let sweepStartTime = 0;

const noiseState = {
  type: "white",
  amplitude: 30
};

const sweepState = {
  mode: "manual",
  frequency: 440,
  duration: 10,
  amplitude: 30
};

const hearingMarks = [];

function noiseEnsureAudioContext() {
  if (!noiseAudioCtx) {
    noiseAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (noiseAudioCtx.state === "suspended") {
    noiseAudioCtx.resume();
  }
}

/* ====== Generación de buffers de ruido ====== */
function createNoiseBuffer(type) {
  const bufferSize = noiseAudioCtx.sampleRate * 2; // 2 segundos, en loop
  const buffer = noiseAudioCtx.createBuffer(1, bufferSize, noiseAudioCtx.sampleRate);
  const data = buffer.getChannelData(0);

  if (type === "white") {
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  } else if (type === "pink") {
    // Algoritmo de Paul Kellet (aproximacion habitual de ruido rosa)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.11;
    }
  } else if (type === "brown") {
    // Paseo aleatorio (integracion de ruido blanco), normalizado
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + white * 0.02);
      last = Math.max(-1, Math.min(1, last));
      data[i] = last * 3.5; // compensa la baja amplitud tipica del paseo aleatorio
    }
    // re-normaliza por si supera el rango
    let max = 0;
    for (let i = 0; i < bufferSize; i++) max = Math.max(max, Math.abs(data[i]));
    if (max > 1) for (let i = 0; i < bufferSize; i++) data[i] /= max;
  }

  return buffer;
}

function noiseStartTone() {
  noiseEnsureAudioContext();

  noiseSource = noiseAudioCtx.createBufferSource();
  noiseGain = noiseAudioCtx.createGain();
  noiseAnalyserTime = noiseAudioCtx.createAnalyser();
  noiseAnalyserFreq = noiseAudioCtx.createAnalyser();

  noiseAnalyserTime.fftSize = 2048;
  noiseAnalyserFreq.fftSize = 2048;

  noiseSource.buffer = createNoiseBuffer(noiseState.type);
  noiseSource.loop = true;
  noiseGain.gain.value = noiseState.amplitude / 100;

  noiseSource.connect(noiseGain);
  noiseGain.connect(noiseAnalyserTime);
  noiseGain.connect(noiseAnalyserFreq);
  noiseGain.connect(noiseAudioCtx.destination);

  noiseSource.start();
  noiseIsPlaying = true;
  noiseStartVisualLoop();
}

function noiseStopTone() {
  if (noiseSource) {
    try { noiseSource.stop(); } catch (e) {}
    noiseSource.disconnect();
    noiseGain.disconnect();
    noiseSource = null;
  }
  noiseIsPlaying = false;
  if (!sweepIsPlaying && noiseRafId) {
    cancelAnimationFrame(noiseRafId);
    noiseRafId = null;
  }
  if (!sweepIsPlaying) noiseClearCanvases();
}

let noiseRafId = null;

/* ====== Sweep (barrido de frecuencia) ====== */
function sweepStartTone() {
  noiseEnsureAudioContext();

  sweepOsc = noiseAudioCtx.createOscillator();
  sweepGain = noiseAudioCtx.createGain();
  sweepAnalyserTime = noiseAudioCtx.createAnalyser();
  sweepAnalyserFreq = noiseAudioCtx.createAnalyser();

  sweepAnalyserTime.fftSize = 2048;
  sweepAnalyserFreq.fftSize = 2048;

  sweepOsc.type = "sine";
  sweepGain.gain.value = sweepState.amplitude / 100;

  sweepOsc.connect(sweepGain);
  sweepGain.connect(sweepAnalyserTime);
  sweepGain.connect(sweepAnalyserFreq);
  sweepGain.connect(noiseAudioCtx.destination);

  const now = noiseAudioCtx.currentTime;

  if (sweepState.mode === "auto") {
    sweepOsc.frequency.setValueAtTime(FREQ_MIN, now);
    sweepOsc.frequency.exponentialRampToValueAtTime(FREQ_MAX, now + sweepState.duration);
    sweepStartTime = now;
  } else {
    sweepOsc.frequency.setValueAtTime(sweepState.frequency, now);
  }

  sweepOsc.start(now);
  sweepIsPlaying = true;
  noiseStartVisualLoop();
}

function sweepStopTone() {
  if (sweepOsc) {
    try { sweepOsc.stop(); } catch (e) {}
    sweepOsc.disconnect();
    sweepGain.disconnect();
    sweepOsc = null;
  }
  sweepIsPlaying = false;
  if (!noiseIsPlaying && noiseRafId) {
    cancelAnimationFrame(noiseRafId);
    noiseRafId = null;
  }
  if (!noiseIsPlaying) noiseClearCanvases();
}

/* ====== Visualización ====== */
function noiseClearCanvases() {
  ["noise-oscilloscope", "noise-spectrum"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
  sweepRedrawPosition();
}

function noiseStartVisualLoop() {
  const oscCanvas = document.getElementById("noise-oscilloscope");
  const fftCanvas = document.getElementById("noise-spectrum");

  const oscSetup = setupCanvas(oscCanvas);
  const fftSetup = setupCanvas(fftCanvas);

  function draw() {
    if (!noiseIsPlaying && !sweepIsPlaying) return;

    // Osciloscopio: usa la fuente activa (ruido o sweep); si ambas, prioriza sweep
    const timeAnalyser = sweepIsPlaying ? sweepAnalyserTime : noiseAnalyserTime;
    const freqAnalyser = sweepIsPlaying ? sweepAnalyserFreq : noiseAnalyserFreq;

    const timeData = new Uint8Array(timeAnalyser.fftSize);
    const freqData = new Uint8Array(freqAnalyser.frequencyBinCount);

    timeAnalyser.getByteTimeDomainData(timeData);
    drawOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, timeData);

    freqAnalyser.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);

    if (sweepIsPlaying) sweepUpdatePosition();

    noiseRafId = requestAnimationFrame(draw);
  }

  draw();
}

// Dibuja la barra de posición logarítmica con marcador de frecuencia actual
function sweepRedrawPosition() {
  const canvas = document.getElementById("sweep-position");
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  // pista de fondo
  ctx.fillStyle = getCssVar("--track-bg");
  ctx.fillRect(0, height / 2 - 2, width, 4);

  const freq = sweepCurrentFrequency();
  const ratio = freqToSlider(freq) / 1000; // 0..1
  const x = ratio * width;

  ctx.fillStyle = getCssVar("--wave-color");
  ctx.beginPath();
  ctx.arc(x, height / 2, 8, 0, Math.PI * 2);
  ctx.fill();

  document.getElementById("sweep-current-reading").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k Hz" : Math.round(freq) + " Hz";
}

function sweepCurrentFrequency() {
  if (!sweepIsPlaying) return sweepState.frequency;
  if (sweepState.mode === "manual") return sweepState.frequency;

  const elapsed = noiseAudioCtx.currentTime - sweepStartTime;
  const progress = Math.min(1, elapsed / sweepState.duration);
  return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, progress);
}

function sweepUpdatePosition() {
  sweepRedrawPosition();
  // Al terminar el barrido automatico, se detiene solo
  if (sweepState.mode === "auto") {
    const elapsed = noiseAudioCtx.currentTime - sweepStartTime;
    if (elapsed >= sweepState.duration) {
      sweepStopTone();
      document.getElementById("sweep-play-btn").classList.remove("playing");
      document.getElementById("sweep-play-icon").innerHTML = "&#9658;";
      document.getElementById("sweep-play-label").textContent = t("generate");
    }
  }
}

/* ====== UI: displays ====== */
function noiseUpdateAmpDisplay() {
  document.getElementById("noise-amp-value").textContent = noiseState.amplitude;
}

function sweepUpdateFreqDisplay() {
  const freq = sweepState.frequency;
  document.getElementById("sweep-freq-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById("sweep-note").textContent = `${note.name}${note.octave} — ${solfege}`;

  if (sweepOsc && sweepState.mode === "manual") {
    sweepOsc.frequency.setValueAtTime(sweepState.frequency, noiseAudioCtx.currentTime);
  }
  sweepRedrawPosition();
}

function sweepUpdateAmpDisplay() {
  document.getElementById("sweep-amp-value").textContent = sweepState.amplitude;
}

function sweepUpdateDurationDisplay() {
  document.getElementById("sweep-duration-value").textContent = sweepState.duration;
}

/* ====== Test de rango auditivo ====== */
function renderHearingMarks() {
  const container = document.getElementById("hearing-test-marks");
  container.innerHTML = "";
  hearingMarks.forEach((freq, idx) => {
    const pill = document.createElement("div");
    pill.className = "hearing-mark-pill";
    const label = freq >= 1000 ? (freq / 1000).toFixed(2) + " kHz" : Math.round(freq) + " Hz";
    pill.innerHTML = `<span>${label}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.innerHTML = "&times;";
    removeBtn.setAttribute("aria-label", "remove");
    removeBtn.addEventListener("click", () => {
      hearingMarks.splice(idx, 1);
      renderHearingMarks();
    });
    pill.appendChild(removeBtn);
    container.appendChild(pill);
  });
}

/* ====== Listeners del módulo ====== */
function initNoiseControls() {
  // Tipo de ruido
  document.querySelectorAll("#noise-type-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#noise-type-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      noiseState.type = btn.dataset.noise;
      if (noiseIsPlaying) {
        // Recrea la fuente con el nuevo tipo de ruido
        noiseStopTone();
        noiseStartTone();
      }
    });
  });

  // Amplitud ruido (en vivo)
  const noiseAmpSlider = document.getElementById("noise-amp-slider");
  noiseAmpSlider.addEventListener("input", () => {
    noiseState.amplitude = parseFloat(noiseAmpSlider.value);
    noiseUpdateAmpDisplay();
    if (noiseGain) noiseGain.gain.setValueAtTime(noiseState.amplitude / 100, noiseAudioCtx.currentTime);
  });

  // Play/Stop ruido
  const noisePlayBtn = document.getElementById("noise-play-btn");
  noisePlayBtn.addEventListener("click", () => {
    if (!noiseIsPlaying) {
      noiseStartTone();
      noisePlayBtn.classList.add("playing");
      document.getElementById("noise-play-icon").innerHTML = "&#9632;";
      document.getElementById("noise-play-label").textContent = t("stop");
    } else {
      noiseStopTone();
      noisePlayBtn.classList.remove("playing");
      document.getElementById("noise-play-icon").innerHTML = "&#9658;";
      document.getElementById("noise-play-label").textContent = t("generate");
    }
  });

  // Modo de barrido
  document.querySelectorAll("#sweep-mode-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#sweep-mode-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      sweepState.mode = btn.dataset.sweepMode;
      document.getElementById("sweep-manual-row").hidden = sweepState.mode !== "manual";
      document.getElementById("sweep-duration-row").hidden = sweepState.mode !== "auto";
    });
  });

  // Frecuencia manual
  const sweepFreqSlider = document.getElementById("sweep-freq-slider");
  sweepFreqSlider.addEventListener("input", () => {
    sweepState.frequency = sliderToFreq(parseFloat(sweepFreqSlider.value));
    sweepUpdateFreqDisplay();
  });

  // Duracion del barrido automatico
  const sweepDurationSlider = document.getElementById("sweep-duration-slider");
  sweepDurationSlider.addEventListener("input", () => {
    sweepState.duration = parseFloat(sweepDurationSlider.value);
    sweepUpdateDurationDisplay();
  });

  // Amplitud sweep (en vivo)
  const sweepAmpSlider = document.getElementById("sweep-amp-slider");
  sweepAmpSlider.addEventListener("input", () => {
    sweepState.amplitude = parseFloat(sweepAmpSlider.value);
    sweepUpdateAmpDisplay();
    if (sweepGain) sweepGain.gain.setValueAtTime(sweepState.amplitude / 100, noiseAudioCtx.currentTime);
  });

  // Play/Stop sweep
  const sweepPlayBtn = document.getElementById("sweep-play-btn");
  sweepPlayBtn.addEventListener("click", () => {
    if (!sweepIsPlaying) {
      sweepStartTone();
      sweepPlayBtn.classList.add("playing");
      document.getElementById("sweep-play-icon").innerHTML = "&#9632;";
      document.getElementById("sweep-play-label").textContent = t("stop");
    } else {
      sweepStopTone();
      sweepPlayBtn.classList.remove("playing");
      document.getElementById("sweep-play-icon").innerHTML = "&#9658;";
      document.getElementById("sweep-play-label").textContent = t("generate");
    }
  });

  // Marcar limite audible
  document.getElementById("hearing-mark-btn").addEventListener("click", () => {
    const freq = Math.round(sweepCurrentFrequency());
    hearingMarks.push(freq);
    renderHearingMarks();
  });
}

/* ====== Init del módulo Ruido y barridos ====== */
function noiseInit() {
  initNoiseControls();

  noiseUpdateAmpDisplay();

  document.getElementById("sweep-freq-slider").value = Math.round(freqToSlider(440));
  sweepUpdateFreqDisplay();
  sweepUpdateAmpDisplay();
  sweepUpdateDurationDisplay();

  setTimeout(() => noiseClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", noiseInit);

/* ====================================================== */
/* ====== MÓDULO: FILTROS =============================== */
/* ====================================================== */

let filterAudioCtx = null;
let filterSourceOsc = null;
let filterSourceNoise = null;
let filterGain = null;
let filterBiquad = null;
let filterAnalyserTime = null;
let filterAnalyserFreq = null;
let filterIsPlaying = false;
let filterRafId = null;

const filterState = {
  sourceType: "sawtooth", // "sawtooth" (tono) o "white" (ruido)
  toneFrequency: 220,
  amplitude: 30,
  filterType: "lowpass",
  cutoff: 1000,
  q: 1.0
};

function filterEnsureAudioContext() {
  if (!filterAudioCtx) {
    filterAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (filterAudioCtx.state === "suspended") {
    filterAudioCtx.resume();
  }
}

function filterStartTone() {
  filterEnsureAudioContext();

  filterGain = filterAudioCtx.createGain();
  filterBiquad = filterAudioCtx.createBiquadFilter();
  filterAnalyserTime = filterAudioCtx.createAnalyser();
  filterAnalyserFreq = filterAudioCtx.createAnalyser();

  filterAnalyserTime.fftSize = 2048;
  filterAnalyserFreq.fftSize = 2048;

  filterBiquad.type = filterState.filterType;
  filterBiquad.frequency.value = filterState.cutoff;
  filterBiquad.Q.value = filterState.q;

  filterGain.gain.value = filterState.amplitude / 100;

  if (filterState.sourceType === "white") {
    filterSourceNoise = filterAudioCtx.createBufferSource();
    filterSourceNoise.buffer = createFilterNoiseBuffer();
    filterSourceNoise.loop = true;
    filterSourceNoise.connect(filterBiquad);
    filterSourceNoise.start();
  } else {
    filterSourceOsc = filterAudioCtx.createOscillator();
    filterSourceOsc.type = "sawtooth";
    filterSourceOsc.frequency.value = filterState.toneFrequency;
    filterSourceOsc.connect(filterBiquad);
    filterSourceOsc.start();
  }

  filterBiquad.connect(filterGain);
  filterGain.connect(filterAnalyserTime);
  filterGain.connect(filterAnalyserFreq);
  filterGain.connect(filterAudioCtx.destination);

  filterIsPlaying = true;
  filterStartVisualLoop();
}

// createNoiseBuffer usa noiseAudioCtx; necesitamos una version que use filterAudioCtx
function createFilterNoiseBuffer() {
  const bufferSize = filterAudioCtx.sampleRate * 2;
  const buffer = filterAudioCtx.createBuffer(1, bufferSize, filterAudioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function filterStopTone() {
  [filterSourceOsc, filterSourceNoise].forEach(node => {
    if (node) { try { node.stop(); } catch (e) {} node.disconnect(); }
  });
  filterSourceOsc = filterSourceNoise = null;
  if (filterBiquad) filterBiquad.disconnect();
  if (filterGain) filterGain.disconnect();
  filterBiquad = filterGain = null;

  filterIsPlaying = false;
  if (filterRafId) {
    cancelAnimationFrame(filterRafId);
    filterRafId = null;
  }
  filterClearCanvases();
}

function filterUpdateLiveParams() {
  if (filterBiquad) {
    filterBiquad.type = filterState.filterType;
    filterBiquad.frequency.setValueAtTime(filterState.cutoff, filterAudioCtx.currentTime);
    filterBiquad.Q.setValueAtTime(filterState.q, filterAudioCtx.currentTime);
  }
  if (filterSourceOsc) {
    filterSourceOsc.frequency.setValueAtTime(filterState.toneFrequency, filterAudioCtx.currentTime);
  }
  if (filterGain) {
    filterGain.gain.setValueAtTime(filterState.amplitude / 100, filterAudioCtx.currentTime);
  }
  filterRedrawResponseIfIdle();
}

/* ====== Visualización ====== */
function filterClearCanvases() {
  ["filter-oscilloscope", "filter-spectrum"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
  filterRedrawResponseIfIdle();
}

// Cuando no esta sonando, dibuja solo la curva de respuesta del filtro (sin FFT)
function filterRedrawResponseIfIdle() {
  if (filterIsPlaying) return;
  filterEnsureTempBiquad();
  const canvas = document.getElementById("filter-spectrum");
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);
  drawFilterResponse(ctx, width, height, tempBiquadForResponse());
}

let tempFilterCtx = null;
let tempFilterBiquad = null;
function filterEnsureTempBiquad() {
  const ctx = filterAudioCtx || tempFilterCtx;
  if (tempFilterBiquad && tempFilterCtx === ctx) return;
  if (!ctx) {
    tempFilterCtx = new (window.AudioContext || window.webkitAudioContext)();
    tempFilterBiquad = tempFilterCtx.createBiquadFilter();
  } else {
    tempFilterCtx = ctx;
    tempFilterBiquad = ctx.createBiquadFilter();
  }
}
function tempBiquadForResponse() {
  tempFilterBiquad.type = filterState.filterType;
  tempFilterBiquad.frequency.value = filterState.cutoff;
  tempFilterBiquad.Q.value = filterState.q;
  return tempFilterBiquad;
}

function filterStartVisualLoop() {
  const oscCanvas = document.getElementById("filter-oscilloscope");
  const fftCanvas = document.getElementById("filter-spectrum");

  const oscSetup = setupCanvas(oscCanvas);
  const fftSetup = setupCanvas(fftCanvas);

  const timeData = new Uint8Array(filterAnalyserTime.fftSize);
  const freqData = new Uint8Array(filterAnalyserFreq.frequencyBinCount);

  function draw() {
    if (!filterIsPlaying) return;

    filterAnalyserTime.getByteTimeDomainData(timeData);
    drawOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, timeData);

    filterAnalyserFreq.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);
    drawFilterResponse(fftSetup.ctx, fftSetup.width, fftSetup.height, filterBiquad);

    filterRafId = requestAnimationFrame(draw);
  }

  draw();
}

// Dibuja la curva de respuesta en frecuencia del filtro biquad sobre el canvas FFT
function drawFilterResponse(ctx, width, height, biquadNode) {
  const numPoints = 200;
  const freqs = new Float32Array(numPoints);
  const mag = new Float32Array(numPoints);
  const phase = new Float32Array(numPoints);

  for (let i = 0; i < numPoints; i++) {
    // distribucion logaritmica 20Hz - 20kHz, igual que el eje del FFT (data.length bins lineales hasta sampleRate/2,
    // pero visualmente usamos la misma escala que drawSpectrum: bin index lineal => aqui aproximamos con escala log)
    const ratio = i / (numPoints - 1);
    freqs[i] = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, ratio);
  }

  biquadNode.getFrequencyResponse(freqs, mag, phase);

  ctx.lineWidth = 2;
  ctx.strokeStyle = getCssVar("--wave-color");
  ctx.beginPath();

  for (let i = 0; i < numPoints; i++) {
    const x = (i / (numPoints - 1)) * width;
    // mag en dB, normalizado aproximadamente a 0..1 sobre un rango de -48..+12 dB
    const db = 20 * Math.log10(Math.max(mag[i], 0.0001));
    const norm = Math.max(0, Math.min(1, (db + 48) / 60));
    const y = height - norm * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/* ====== UI: displays ====== */
function filterUpdateToneFreqDisplay() {
  const freq = filterState.toneFrequency;
  document.getElementById("filter-tone-freq-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById("filter-tone-note").textContent = `${note.name}${note.octave} — ${solfege}`;
}

function filterUpdateAmpDisplay() {
  document.getElementById("filter-amp-value").textContent = filterState.amplitude;
}

function filterUpdateCutoffDisplay() {
  const freq = filterState.cutoff;
  document.getElementById("filter-cutoff-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);
}

function filterUpdateQDisplay() {
  document.getElementById("filter-q-value").textContent = filterState.q.toFixed(1);
}

/* ====== Listeners del módulo ====== */
function initFilterControls() {
  // Tipo de fuente
  document.querySelectorAll("#filter-source-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#filter-source-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterState.sourceType = btn.dataset.source;
      document.getElementById("filter-freq-row").hidden = filterState.sourceType !== "sawtooth";
      if (filterIsPlaying) {
        filterStopTone();
        filterStartTone();
        document.getElementById("filter-play-btn").classList.add("playing");
        document.getElementById("filter-play-icon").innerHTML = "&#9632;";
        document.getElementById("filter-play-label").textContent = t("stop");
      }
    });
  });

  // Frecuencia del tono
  const toneFreqSlider = document.getElementById("filter-tone-freq-slider");
  toneFreqSlider.addEventListener("input", () => {
    filterState.toneFrequency = sliderToFreq(parseFloat(toneFreqSlider.value));
    filterUpdateToneFreqDisplay();
    filterUpdateLiveParams();
  });

  // Amplitud
  const ampSlider = document.getElementById("filter-amp-slider");
  ampSlider.addEventListener("input", () => {
    filterState.amplitude = parseFloat(ampSlider.value);
    filterUpdateAmpDisplay();
    filterUpdateLiveParams();
  });

  // Tipo de filtro
  document.querySelectorAll("#filter-type-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#filter-type-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterState.filterType = btn.dataset.filter;
      filterUpdateLiveParams();
    });
  });

  // Frecuencia de corte
  const cutoffSlider = document.getElementById("filter-cutoff-slider");
  cutoffSlider.addEventListener("input", () => {
    filterState.cutoff = sliderToFreq(parseFloat(cutoffSlider.value));
    filterUpdateCutoffDisplay();
    filterUpdateLiveParams();
  });

  // Resonancia (Q): slider 1-200 -> 0.1-20.0
  const qSlider = document.getElementById("filter-q-slider");
  qSlider.addEventListener("input", () => {
    filterState.q = parseFloat(qSlider.value) / 10;
    filterUpdateQDisplay();
    filterUpdateLiveParams();
  });

  // Play/Stop
  const filterPlayBtn = document.getElementById("filter-play-btn");
  filterPlayBtn.addEventListener("click", () => {
    if (!filterIsPlaying) {
      filterStartTone();
      filterPlayBtn.classList.add("playing");
      document.getElementById("filter-play-icon").innerHTML = "&#9632;";
      document.getElementById("filter-play-label").textContent = t("stop");
    } else {
      filterStopTone();
      filterPlayBtn.classList.remove("playing");
      document.getElementById("filter-play-icon").innerHTML = "&#9658;";
      document.getElementById("filter-play-label").textContent = t("generate");
    }
  });
}

/* ====== Init del módulo Filtros ====== */
function filterInit() {
  initFilterControls();

  document.getElementById("filter-tone-freq-slider").value = Math.round(freqToSlider(220));
  filterUpdateToneFreqDisplay();
  filterUpdateAmpDisplay();

  document.getElementById("filter-cutoff-slider").value = Math.round(freqToSlider(1000));
  filterUpdateCutoffDisplay();
  filterUpdateQDisplay();

  setTimeout(() => filterClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", filterInit);

/* ====================================================== */
/* ====== MÓDULO: MUESTREO Y CUANTIZACIÓN =============== */
/* ====================================================== */

let samplingAudioCtx = null;
let samplingOsc = null;
let samplingGain = null;
let samplingProcessor = null;
let samplingAnalyserOriginal = null;
let samplingAnalyserProcessed = null;
let samplingAnalyserFreq = null;
let samplingIsPlaying = false;
let samplingRafId = null;

const samplingState = {
  frequency: 440,
  amplitude: 40,
  sampleRate: 8000,
  bitDepth: 8
};

function samplingEnsureAudioContext() {
  if (!samplingAudioCtx) {
    samplingAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (samplingAudioCtx.state === "suspended") {
    samplingAudioCtx.resume();
  }
}

function samplingStartTone() {
  samplingEnsureAudioContext();

  samplingOsc = samplingAudioCtx.createOscillator();
  samplingGain = samplingAudioCtx.createGain();
  samplingAnalyserOriginal = samplingAudioCtx.createAnalyser();
  samplingAnalyserProcessed = samplingAudioCtx.createAnalyser();
  samplingAnalyserFreq = samplingAudioCtx.createAnalyser();

  samplingAnalyserOriginal.fftSize = 2048;
  samplingAnalyserProcessed.fftSize = 2048;
  samplingAnalyserFreq.fftSize = 2048;

  samplingOsc.type = "sine";
  samplingOsc.frequency.value = samplingState.frequency;
  samplingGain.gain.value = samplingState.amplitude / 100;

  // ScriptProcessor: aplica sample-and-hold (downsample) y cuantizacion
  const bufferSize = 1024;
  samplingProcessor = samplingAudioCtx.createScriptProcessor(bufferSize, 1, 1);
  let holdValue = 0;
  let holdCounter = 0;

  samplingProcessor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const output = e.outputBuffer.getChannelData(0);
    const ctxRate = samplingAudioCtx.sampleRate;
    const targetRate = samplingState.sampleRate;
    const holdSamples = Math.max(1, Math.round(ctxRate / targetRate));
    const levels = Math.pow(2, samplingState.bitDepth);

    for (let i = 0; i < input.length; i++) {
      if (holdCounter <= 0) {
        // Cuantizacion: redondea al nivel mas cercano de 'levels' pasos entre -1 y 1
        const quantized = Math.round(input[i] * (levels / 2)) / (levels / 2);
        holdValue = Math.max(-1, Math.min(1, quantized));
        holdCounter = holdSamples;
      }
      output[i] = holdValue;
      holdCounter--;
    }
  };

  samplingOsc.connect(samplingAnalyserOriginal);
  samplingOsc.connect(samplingProcessor);
  samplingProcessor.connect(samplingGain);
  samplingGain.connect(samplingAnalyserProcessed);
  samplingGain.connect(samplingAnalyserFreq);
  samplingGain.connect(samplingAudioCtx.destination);

  samplingOsc.start();
  samplingIsPlaying = true;
  samplingStartVisualLoop();
}

function samplingStopTone() {
  if (samplingOsc) {
    try { samplingOsc.stop(); } catch (e) {}
    samplingOsc.disconnect();
  }
  if (samplingProcessor) {
    samplingProcessor.onaudioprocess = null;
    samplingProcessor.disconnect();
  }
  if (samplingGain) samplingGain.disconnect();
  samplingOsc = samplingProcessor = samplingGain = null;

  samplingIsPlaying = false;
  if (samplingRafId) {
    cancelAnimationFrame(samplingRafId);
    samplingRafId = null;
  }
  samplingClearCanvases();
}

function samplingUpdateLiveParams() {
  if (samplingOsc) {
    samplingOsc.frequency.setValueAtTime(samplingState.frequency, samplingAudioCtx.currentTime);
  }
  if (samplingGain) {
    samplingGain.gain.setValueAtTime(samplingState.amplitude / 100, samplingAudioCtx.currentTime);
  }
}

/* ====== Visualización ====== */
function samplingClearCanvases() {
  ["sampling-oscilloscope", "sampling-spectrum"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
}

function samplingStartVisualLoop() {
  const oscCanvas = document.getElementById("sampling-oscilloscope");
  const fftCanvas = document.getElementById("sampling-spectrum");

  const oscSetup = setupCanvas(oscCanvas);
  const fftSetup = setupCanvas(fftCanvas);

  const dataOriginal = new Uint8Array(samplingAnalyserOriginal.fftSize);
  const dataProcessed = new Uint8Array(samplingAnalyserProcessed.fftSize);
  const freqData = new Uint8Array(samplingAnalyserFreq.frequencyBinCount);

  function draw() {
    if (!samplingIsPlaying) return;

    samplingAnalyserOriginal.getByteTimeDomainData(dataOriginal);
    samplingAnalyserProcessed.getByteTimeDomainData(dataProcessed);
    drawSamplingOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, dataOriginal, dataProcessed);

    samplingAnalyserFreq.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);

    samplingRafId = requestAnimationFrame(draw);
  }

  draw();
}

function drawSamplingOscilloscope(ctx, width, height, dataOriginal, dataProcessed) {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  dualDrawTrace(ctx, width, height, dataOriginal, getCssVar("--wave-color"));
  dualDrawTrace(ctx, width, height, dataProcessed, getCssVar("--accent2"));
}

/* ====== UI: displays ====== */
function samplingUpdateFreqDisplay() {
  const freq = samplingState.frequency;
  document.getElementById("sampling-freq-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById("sampling-note").textContent = `${note.name}${note.octave} — ${solfege}`;
}

function samplingUpdateAmpDisplay() {
  document.getElementById("sampling-amp-value").textContent = samplingState.amplitude;
}

function samplingUpdateSampleRateDisplay() {
  document.getElementById("sample-rate-value").textContent = samplingState.sampleRate;
  samplingUpdateNyquistHint();
}

function samplingUpdateBitDepthDisplay() {
  const bits = samplingState.bitDepth;
  document.getElementById("bit-depth-value").textContent = bits;
  const levels = Math.pow(2, bits);
  document.getElementById("bit-depth-levels").textContent = `${levels} ${t("levels_suffix")}`;
}

function samplingUpdateNyquistHint() {
  const nyquist = samplingState.sampleRate / 2;
  const template = t("nyquist_hint");
  document.getElementById("nyquist-hint").textContent = template.replace("{freq}", nyquist);
}

/* ====== Listeners del módulo ====== */
function initSamplingControls() {
  // Frecuencia
  const freqSlider = document.getElementById("sampling-freq-slider");
  freqSlider.addEventListener("input", () => {
    samplingState.frequency = sliderToFreq(parseFloat(freqSlider.value));
    samplingUpdateFreqDisplay();
    samplingUpdateLiveParams();
  });

  // Amplitud
  const ampSlider = document.getElementById("sampling-amp-slider");
  ampSlider.addEventListener("input", () => {
    samplingState.amplitude = parseFloat(ampSlider.value);
    samplingUpdateAmpDisplay();
    samplingUpdateLiveParams();
  });

  // Frecuencia de muestreo (en vivo, leida directamente del processor)
  const sampleRateSlider = document.getElementById("sample-rate-slider");
  sampleRateSlider.addEventListener("input", () => {
    samplingState.sampleRate = parseFloat(sampleRateSlider.value);
    samplingUpdateSampleRateDisplay();
  });

  // Profundidad de bits (en vivo)
  const bitDepthSlider = document.getElementById("bit-depth-slider");
  bitDepthSlider.addEventListener("input", () => {
    samplingState.bitDepth = parseFloat(bitDepthSlider.value);
    samplingUpdateBitDepthDisplay();
  });

  // Play/Stop
  const samplingPlayBtn = document.getElementById("sampling-play-btn");
  samplingPlayBtn.addEventListener("click", () => {
    if (!samplingIsPlaying) {
      samplingStartTone();
      samplingPlayBtn.classList.add("playing");
      document.getElementById("sampling-play-icon").innerHTML = "&#9632;";
      document.getElementById("sampling-play-label").textContent = t("stop");
    } else {
      samplingStopTone();
      samplingPlayBtn.classList.remove("playing");
      document.getElementById("sampling-play-icon").innerHTML = "&#9658;";
      document.getElementById("sampling-play-label").textContent = t("generate");
    }
  });
}

/* ====== Init del módulo Muestreo ====== */
function samplingInit() {
  initSamplingControls();

  document.getElementById("sampling-freq-slider").value = Math.round(freqToSlider(440));
  samplingUpdateFreqDisplay();
  samplingUpdateAmpDisplay();
  samplingUpdateSampleRateDisplay();
  samplingUpdateBitDepthDisplay();

  setTimeout(() => samplingClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", samplingInit);

/* ====================================================== */
/* ====== MÓDULO: ESTÉREO (pan / Haas) ================== */
/* ====================================================== */

let stereoAudioCtx = null;
let stereoOsc = null;
let stereoGain = null;
let stereoPanner = null;
let stereoSplitter = null;
let stereoMerger = null;
let stereoDelayL = null;
let stereoDelayR = null;
let stereoAnalyserL = null;
let stereoAnalyserR = null;
let stereoIsPlaying = false;
let stereoRafId = null;

const stereoState = {
  waveform: "sine",
  frequency: 440,
  amplitude: 40,
  pan: 0,
  delay: 0,           // ms
  delayChannel: "right" // canal al que se aplica el retardo (Haas)
};

function stereoEnsureAudioContext() {
  if (!stereoAudioCtx) {
    stereoAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (stereoAudioCtx.state === "suspended") {
    stereoAudioCtx.resume();
  }
}

function stereoStartTone() {
  stereoEnsureAudioContext();

  stereoOsc = stereoAudioCtx.createOscillator();
  stereoGain = stereoAudioCtx.createGain();
  stereoPanner = stereoAudioCtx.createStereoPanner();
  stereoSplitter = stereoAudioCtx.createChannelSplitter(2);
  stereoMerger = stereoAudioCtx.createChannelMerger(2);
  stereoDelayL = stereoAudioCtx.createDelay(0.05);
  stereoDelayR = stereoAudioCtx.createDelay(0.05);
  stereoAnalyserL = stereoAudioCtx.createAnalyser();
  stereoAnalyserR = stereoAudioCtx.createAnalyser();

  stereoAnalyserL.fftSize = 2048;
  stereoAnalyserR.fftSize = 2048;

  stereoOsc.type = stereoState.waveform;
  stereoOsc.frequency.value = stereoState.frequency;
  stereoGain.gain.value = stereoState.amplitude / 100;
  stereoPanner.pan.value = stereoState.pan / 100;

  const delaySec = stereoState.delay / 1000;
  stereoDelayL.delayTime.value = stereoState.delayChannel === "left" ? delaySec : 0;
  stereoDelayR.delayTime.value = stereoState.delayChannel === "right" ? delaySec : 0;

  // osc -> gain -> panner -> splitter -> [delayL/delayR] -> merger -> destino
  // y tambien -> analysers L/R para visualizacion independiente de cada canal
  stereoOsc.connect(stereoGain);
  stereoGain.connect(stereoPanner);
  stereoPanner.connect(stereoSplitter);

  stereoSplitter.connect(stereoDelayL, 0);
  stereoSplitter.connect(stereoDelayR, 1);

  stereoDelayL.connect(stereoMerger, 0, 0);
  stereoDelayR.connect(stereoMerger, 0, 1);

  stereoDelayL.connect(stereoAnalyserL);
  stereoDelayR.connect(stereoAnalyserR);

  stereoMerger.connect(stereoAudioCtx.destination);

  stereoOsc.start();
  stereoIsPlaying = true;
  stereoStartVisualLoop();
}

function stereoStopTone() {
  if (stereoOsc) {
    try { stereoOsc.stop(); } catch (e) {}
    stereoOsc.disconnect();
  }
  [stereoGain, stereoPanner, stereoSplitter, stereoMerger, stereoDelayL, stereoDelayR].forEach(n => {
    if (n) try { n.disconnect(); } catch (e) {}
  });
  stereoOsc = stereoGain = stereoPanner = stereoSplitter = stereoMerger = stereoDelayL = stereoDelayR = null;

  stereoIsPlaying = false;
  if (stereoRafId) {
    cancelAnimationFrame(stereoRafId);
    stereoRafId = null;
  }
  stereoClearCanvases();
}

function stereoUpdateLiveParams() {
  if (stereoOsc) {
    stereoOsc.type = stereoState.waveform;
    stereoOsc.frequency.setValueAtTime(stereoState.frequency, stereoAudioCtx.currentTime);
  }
  if (stereoGain) {
    stereoGain.gain.setValueAtTime(stereoState.amplitude / 100, stereoAudioCtx.currentTime);
  }
  if (stereoPanner) {
    stereoPanner.pan.setValueAtTime(stereoState.pan / 100, stereoAudioCtx.currentTime);
  }
  if (stereoDelayL && stereoDelayR) {
    const delaySec = stereoState.delay / 1000;
    stereoDelayL.delayTime.setValueAtTime(stereoState.delayChannel === "left" ? delaySec : 0, stereoAudioCtx.currentTime);
    stereoDelayR.delayTime.setValueAtTime(stereoState.delayChannel === "right" ? delaySec : 0, stereoAudioCtx.currentTime);
  }
}

/* ====== Visualización ====== */
function stereoClearCanvases() {
  ["stereo-oscilloscope", "stereo-balance"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    if (id === "stereo-oscilloscope") drawGrid(ctx, width, height);
  });
  stereoRedrawBalance(0);
}

function stereoStartVisualLoop() {
  const oscCanvas = document.getElementById("stereo-oscilloscope");
  const balanceCanvas = document.getElementById("stereo-balance");

  const oscSetup = setupCanvas(oscCanvas);
  const balanceSetup = setupCanvas(balanceCanvas);

  const dataL = new Uint8Array(stereoAnalyserL.fftSize);
  const dataR = new Uint8Array(stereoAnalyserR.fftSize);
  const meterL = new Float32Array(stereoAnalyserL.fftSize);
  const meterR = new Float32Array(stereoAnalyserR.fftSize);

  function draw() {
    if (!stereoIsPlaying) return;

    stereoAnalyserL.getByteTimeDomainData(dataL);
    stereoAnalyserR.getByteTimeDomainData(dataR);
    drawStereoOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, dataL, dataR);

    stereoAnalyserL.getFloatTimeDomainData(meterL);
    stereoAnalyserR.getFloatTimeDomainData(meterR);
    const rmsL = stereoRms(meterL);
    const rmsR = stereoRms(meterR);
    const balance = (rmsR - rmsL) / Math.max(rmsL + rmsR, 0.0001); // -1 (L) .. +1 (R)
    stereoRedrawBalance(balance, balanceSetup);

    stereoRafId = requestAnimationFrame(draw);
  }

  draw();
}

function stereoRms(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

function drawStereoOscilloscope(ctx, width, height, dataL, dataR) {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  dualDrawTrace(ctx, width, height, dataL, getCssVar("--wave-color"));
  dualDrawTrace(ctx, width, height, dataR, getCssVar("--accent2"));
}

// Barra horizontal con marcador de balance: centro = 0, izquierda = -1, derecha = +1
function stereoRedrawBalance(balance, setup) {
  const canvas = document.getElementById("stereo-balance");
  const { ctx, width, height } = setup || setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  // pista de fondo
  ctx.fillStyle = getCssVar("--track-bg");
  ctx.fillRect(0, height / 2 - 2, width, 4);

  // marca central
  ctx.fillStyle = getCssVar("--grid-line");
  ctx.fillRect(width / 2 - 1, height / 2 - 8, 2, 16);

  const clamped = Math.max(-1, Math.min(1, balance));
  const x = (width / 2) + (clamped * width / 2);

  ctx.fillStyle = getCssVar("--wave-color");
  ctx.beginPath();
  ctx.arc(x, height / 2, 8, 0, Math.PI * 2);
  ctx.fill();
}

/* ====== UI: displays ====== */
function stereoUpdateFreqDisplay() {
  const freq = stereoState.frequency;
  document.getElementById("stereo-freq-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById("stereo-note").textContent = `${note.name}${note.octave} — ${solfege}`;
}

function stereoUpdateAmpDisplay() {
  document.getElementById("stereo-amp-value").textContent = stereoState.amplitude;
}

function stereoUpdatePanDisplay() {
  document.getElementById("stereo-pan-value").textContent = stereoState.pan;
}

function stereoUpdateDelayDisplay() {
  document.getElementById("stereo-delay-value").textContent = stereoState.delay;
}

/* ====== Listeners del módulo ====== */
function initStereoControls() {
  // Forma de onda
  document.querySelectorAll("#stereo-waveform-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#stereo-waveform-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      stereoState.waveform = btn.dataset.wave;
      stereoUpdateLiveParams();
    });
  });

  // Frecuencia
  const freqSlider = document.getElementById("stereo-freq-slider");
  freqSlider.addEventListener("input", () => {
    stereoState.frequency = sliderToFreq(parseFloat(freqSlider.value));
    stereoUpdateFreqDisplay();
    stereoUpdateLiveParams();
  });

  // Amplitud
  const ampSlider = document.getElementById("stereo-amp-slider");
  ampSlider.addEventListener("input", () => {
    stereoState.amplitude = parseFloat(ampSlider.value);
    stereoUpdateAmpDisplay();
    stereoUpdateLiveParams();
  });

  // Pan (con snap-to-zero magnetico, igual que el Generador)
  const panSlider = document.getElementById("stereo-pan-slider");
  const PAN_SNAP_THRESHOLD = 4;
  panSlider.addEventListener("input", () => {
    let value = parseFloat(panSlider.value);
    if (Math.abs(value) <= PAN_SNAP_THRESHOLD) {
      value = 0;
      panSlider.value = "0";
    }
    stereoState.pan = value;
    stereoUpdatePanDisplay();
    stereoUpdateLiveParams();
  });

  // Retardo Haas
  const delaySlider = document.getElementById("stereo-delay-slider");
  delaySlider.addEventListener("input", () => {
    stereoState.delay = parseFloat(delaySlider.value);
    stereoUpdateDelayDisplay();
    stereoUpdateLiveParams();
  });

  // Canal retardado
  document.querySelectorAll("#stereo-delay-channel-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#stereo-delay-channel-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      stereoState.delayChannel = btn.dataset.channel;
      stereoUpdateLiveParams();
    });
  });

  // Play/Stop
  const stereoPlayBtn = document.getElementById("stereo-play-btn");
  stereoPlayBtn.addEventListener("click", () => {
    if (!stereoIsPlaying) {
      stereoStartTone();
      stereoPlayBtn.classList.add("playing");
      document.getElementById("stereo-play-icon").innerHTML = "&#9632;";
      document.getElementById("stereo-play-label").textContent = t("stop");
    } else {
      stereoStopTone();
      stereoPlayBtn.classList.remove("playing");
      document.getElementById("stereo-play-icon").innerHTML = "&#9658;";
      document.getElementById("stereo-play-label").textContent = t("generate");
    }
  });
}

/* ====== Init del módulo Estéreo ====== */
function stereoInit() {
  initStereoControls();

  document.getElementById("stereo-freq-slider").value = Math.round(freqToSlider(440));
  stereoUpdateFreqDisplay();
  stereoUpdateAmpDisplay();
  stereoUpdatePanDisplay();
  stereoUpdateDelayDisplay();

  setTimeout(() => stereoClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", stereoInit);


/* ============================================================
   ====== MÓDULO: DUB SIREN (Benidub DS71) ======
   Réplica jugable del pedal sintetizador de sirenas dub.
   Cadena: VCO -> VCF(lowpass) -> VCA(envolvente) -> TONE -> VOLUME -> salida
   LFO -> profundidad -> frecuencia del VCO (wobble de sirena)
   ============================================================ */

let dubAudioCtx = null;
let dubVco = null, dubVcf = null, dubVca = null, dubTone = null, dubOut = null;
let dubLfo = null, dubLfoGain = null;
let dubAnalyserTime = null, dubAnalyserFreq = null;
let dubIsPlaying = false;   // grafo vivo (osciladores corriendo)
let dubHeld = false;        // hay un pad/tecla mantenido
let dubHeldPad = null;
let dubLatchedPad = null;   // pad fijado (modo latch)
let dubDroning = false;     // sonando en modo DECAY ∞ tras soltar
let dubRafId = null;

const dubState = {
  bank: 0,          // 0 = A, 1 = B
  preset: 0,        // 0..3
  volume: 0.8,      // 0..1
  decay: 0.35,      // segundos
  depth: 0.35,      // 0..1
  tune: 390,        // Hz (30..9000)
  sweep: 0,         // -1 (UP) .. 0 (FLAT) .. +1 (DOWN)
  rate: 1.0,        // Hz LFO
  toneDb: 0,        // -15..+15 dB (highshelf)
  filterMode: "filter",  // "filter" | "filtertune"
  triggerMode: "hold"    // "hold" (mantener, fiel al pedal) | "latch" (fijar)
};

// Alterna un pad: dispara o para según el modo de disparo
function dubPadToggle(idx) {
  if (dubState.triggerMode === "latch") {
    if (dubLatchedPad === idx) { dubRelease(true); dubLatchedPad = null; }
    else { dubTrigger(idx); dubLatchedPad = idx; }
  } else {
    dubTrigger(idx);
  }
}

// Presets: 2 bancos x 4 ondas de LFO. rate/depth = multiplicadores de carácter.
const DUB_PRESETS = [
  // Banco A (suave -> duro)
  [ { wave: "sine",     rate: 1,   depth: 1.0 },
    { wave: "triangle", rate: 1,   depth: 1.0 },
    { wave: "square",   rate: 1,   depth: 1.0 },
    { wave: "sawtooth", rate: 1,   depth: 1.0 } ],
  // Banco B (más rápido / agresivo)
  [ { wave: "sawtooth", rate: 2,   depth: 1.4 },
    { wave: "square",   rate: 2,   depth: 1.2 },
    { wave: "triangle", rate: 0.5, depth: 1.6 },
    { wave: "sine",     rate: 3,   depth: 0.8 } ]
];

const DUB_WAVE_PATHS = {
  sine: "M0 9 C 3 0, 4 0, 7 9 C 10 18, 11 18, 14 9 C 17 0, 18 0, 21 9 C 24 18, 25 18, 28 9",
  square: "M0 14 L0 2 L14 2 L14 16 L28 16 L28 4",
  triangle: "M0 14 L7 2 L21 16 L28 4",
  sawtooth: "M0 16 L9 2 L9 16 L18 2 L18 16 L27 2"
};

function dubWaveSVG(type) {
  return `<svg viewBox="0 0 28 18"><path d="${DUB_WAVE_PATHS[type]}" fill="none" stroke="#e8e8ea" stroke-width="2"/></svg>`;
}

/* ------ Mapeos de knob ------ */
function dubExpMap(norm, lo, hi) { return lo * Math.pow(hi / lo, norm); }
function dubLinMap(norm, lo, hi) { return lo + (hi - lo) * norm; }

/* ------ Audio ------ */
function dubEnsureAudioContext() {
  if (!dubAudioCtx) {
    dubAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (dubAudioCtx.state === "suspended") {
    dubAudioCtx.resume();
  }
}

function dubEnsureGraph() {
  if (dubIsPlaying) return;
  dubEnsureAudioContext();
  const ctx = dubAudioCtx;

  dubVco = ctx.createOscillator();
  dubVco.type = "sawtooth";
  dubVco.frequency.value = dubState.tune;

  dubVcf = ctx.createBiquadFilter();
  dubVcf.type = "lowpass";
  dubVcf.frequency.value = dubCutoffHeld();
  dubVcf.Q.value = 6;

  dubVca = ctx.createGain();
  dubVca.gain.value = 0.0001;

  dubTone = ctx.createBiquadFilter();
  dubTone.type = "highshelf";
  dubTone.frequency.value = 2000;
  dubTone.gain.value = dubState.toneDb;

  dubOut = ctx.createGain();
  dubOut.gain.value = dubState.volume;

  dubAnalyserTime = ctx.createAnalyser();
  dubAnalyserTime.fftSize = 2048;
  dubAnalyserFreq = ctx.createAnalyser();
  dubAnalyserFreq.fftSize = 2048;

  // LFO -> pitch del VCO
  dubLfo = ctx.createOscillator();
  dubLfo.type = DUB_PRESETS[dubState.bank][dubState.preset].wave;
  dubLfo.frequency.value = dubLfoRateHz();
  dubLfoGain = ctx.createGain();
  dubLfoGain.gain.value = dubLfoDepthHz();

  // Cadena de audio
  dubVco.connect(dubVcf);
  dubVcf.connect(dubVca);
  dubVca.connect(dubTone);
  dubTone.connect(dubOut);
  dubOut.connect(dubAnalyserTime);
  dubOut.connect(dubAnalyserFreq);
  dubOut.connect(ctx.destination);

  dubLfo.connect(dubLfoGain);
  dubLfoGain.connect(dubVco.frequency);

  dubVco.start();
  dubLfo.start();

  dubIsPlaying = true;
  dubStartVisualLoop();
}

function dubCutoffHeld() {
  return Math.min(16000, Math.max(1200, dubState.tune * 4));
}

function dubLfoRateHz() {
  return dubState.rate * DUB_PRESETS[dubState.bank][dubState.preset].rate;
}

function dubLfoDepthHz() {
  const presetDepth = DUB_PRESETS[dubState.bank][dubState.preset].depth;
  return dubState.depth * dubState.tune * 0.9 * presetDepth;
}

// Dispara la sirena (pad/tecla pulsado)
function dubTrigger(padIndex) {
  dubEnsureGraph();
  dubState.preset = padIndex;
  const preset = DUB_PRESETS[dubState.bank][padIndex];
  const ctx = dubAudioCtx;
  const now = ctx.currentTime;

  // LFO: onda + rango del preset
  dubLfo.type = preset.wave;
  dubLfo.frequency.setValueAtTime(dubLfoRateHz(), now);
  dubLfoGain.gain.setValueAtTime(dubLfoDepthHz(), now);

  // VCO: frecuencia base (el LFO modula encima)
  dubVco.frequency.cancelScheduledValues(now);
  dubVco.frequency.setValueAtTime(dubState.tune, now);

  // Filtro abierto mientras se mantiene (como un cutoff normal)
  dubVcf.frequency.cancelScheduledValues(now);
  dubVcf.frequency.setValueAtTime(dubCutoffHeld(), now);

  // Envolvente: attack rápido a pico
  const peak = 0.9;
  dubVca.gain.cancelScheduledValues(now);
  dubVca.gain.setValueAtTime(Math.max(dubVca.gain.value, 0.0001), now);
  dubVca.gain.linearRampToValueAtTime(peak, now + 0.008);

  dubHeld = true;
  dubDroning = false;
  dubHeldPad = padIndex;

  // Marca visual del pad
  document.querySelectorAll("#dub-pads .ds71-pad").forEach(p => {
    p.classList.toggle("active", parseInt(p.dataset.pad, 10) === padIndex);
  });
}

// Suelta: decay + barrido de filtro (y de tono si FILTER+TUNE)
// force=true corta siempre (release corto); force=false respeta DECAY ∞ (drone)
function dubRelease(force) {
  if (!dubIsPlaying) return;
  const infinite = (dubState.decay === Infinity);

  // Mantener con DECAY al máximo: se queda sonando (drone), no cae
  if (dubHeld && infinite && !force) {
    dubHeld = false;
    dubDroning = true;
    dubHeldPad = null;
    document.querySelectorAll("#dub-pads .ds71-pad").forEach(p => p.classList.remove("active"));
    return;
  }
  if (!dubHeld && !dubDroning) return;

  dubHeld = false;
  dubDroning = false;
  const ctx = dubAudioCtx;
  const now = ctx.currentTime;
  const decay = force ? 0.3 : (infinite ? 0.3 : dubState.decay);

  // VCA -> silencio
  const cur = Math.max(dubVca.gain.value, 0.0001);
  dubVca.gain.cancelScheduledValues(now);
  dubVca.gain.setValueAtTime(cur, now);
  dubVca.gain.linearRampToValueAtTime(0.0001, now + decay);

  // Barrido del filtro según SWEEP
  const sweepVal = dubState.sweep;         // -1 UP .. +1 DOWN
  const amt = Math.abs(sweepVal);
  const held = dubCutoffHeld();
  dubVcf.frequency.cancelScheduledValues(now);
  dubVcf.frequency.setValueAtTime(held, now);
  if (amt > 0.05) {
    let target;
    if (sweepVal < 0) target = held + (16000 - held) * amt;   // UP: abre
    else target = held - (held - 150) * amt;                  // DOWN: cierra
    dubVcf.frequency.exponentialRampToValueAtTime(Math.max(60, target), now + decay);

    // FILTER+TUNE: el barrido también mueve el tono
    if (dubState.filterMode === "filtertune") {
      const semis = amt * 12;
      const factor = Math.pow(2, semis / 12);
      const pitchTarget = sweepVal < 0 ? dubState.tune * factor : dubState.tune / factor;
      dubVco.frequency.cancelScheduledValues(now);
      dubVco.frequency.setValueAtTime(dubState.tune, now);
      dubVco.frequency.exponentialRampToValueAtTime(
        Math.min(12000, Math.max(20, pitchTarget)), now + decay);
    }
  }

  // Quitar marca visual
  document.querySelectorAll("#dub-pads .ds71-pad").forEach(p => p.classList.remove("active"));
  dubHeldPad = null;
}

function dubStopTone() {
  if (!dubIsPlaying) return;
  try { dubVco.stop(); } catch (e) {}
  try { dubLfo.stop(); } catch (e) {}
  [dubVco, dubVcf, dubVca, dubTone, dubOut, dubLfo, dubLfoGain,
   dubAnalyserTime, dubAnalyserFreq].forEach(n => { try { n.disconnect(); } catch (e) {} });
  dubVco = dubVcf = dubVca = dubTone = dubOut = dubLfo = dubLfoGain = null;
  dubAnalyserTime = dubAnalyserFreq = null;
  dubIsPlaying = false;
  dubHeld = false;
  dubDroning = false;
  dubHeldPad = null;
  dubLatchedPad = null;
  if (dubRafId) cancelAnimationFrame(dubRafId);
  document.querySelectorAll("#dub-pads .ds71-pad").forEach(p => p.classList.remove("active"));
  dubClearCanvases();
  dubResetRateLed();
}

/* ------ Parámetros en vivo ------ */
function dubApplyTune() {
  if (dubIsPlaying) {
    const now = dubAudioCtx.currentTime;
    if (dubHeld) dubVco.frequency.setValueAtTime(dubState.tune, now);
    dubLfoGain.gain.setValueAtTime(dubLfoDepthHz(), now);
    if (dubHeld) dubVcf.frequency.setValueAtTime(dubCutoffHeld(), now);
  }
}
function dubApplyDepth() {
  if (dubIsPlaying) dubLfoGain.gain.setValueAtTime(dubLfoDepthHz(), dubAudioCtx.currentTime);
}
function dubApplyRate() {
  if (dubIsPlaying) dubLfo.frequency.setValueAtTime(dubLfoRateHz(), dubAudioCtx.currentTime);
}
function dubApplyVolume() {
  if (dubIsPlaying) dubOut.gain.setValueAtTime(dubState.volume, dubAudioCtx.currentTime);
}
function dubApplyTone() {
  if (dubIsPlaying) dubTone.gain.setValueAtTime(dubState.toneDb, dubAudioCtx.currentTime);
}

/* ------ Visualización ------ */
function dubClearCanvases() {
  ["dub-oscilloscope", "dub-spectrum"].forEach(id => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
}

function dubStartVisualLoop() {
  const oscSetup = setupCanvas(document.getElementById("dub-oscilloscope"));
  const fftSetup = setupCanvas(document.getElementById("dub-spectrum"));
  const timeData = new Uint8Array(dubAnalyserTime.fftSize);
  const freqData = new Uint8Array(dubAnalyserFreq.frequencyBinCount);
  const led = document.getElementById("dub-led-rate");

  function draw() {
    if (!dubIsPlaying) return;
    dubAnalyserTime.getByteTimeDomainData(timeData);
    drawOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, timeData);
    dubAnalyserFreq.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);

    // LED del LFO al ritmo del rate
    if (led) {
      const phase = (dubAudioCtx.currentTime * dubLfoRateHz()) % 1;
      const on = 0.5 + 0.5 * Math.sin(2 * Math.PI * phase);
      const r = Math.round(58 + on * 197), g = Math.round(16 + on * 40), b = Math.round(16 + on * 26);
      led.style.background = `rgb(${r},${g},${b})`;
      led.style.boxShadow = on > 0.5 ? `0 0 ${Math.round(on * 8)}px rgba(255,69,58,${on.toFixed(2)})`
                                     : "inset 0 0 2px rgba(0,0,0,0.8)";
    }
    dubRafId = requestAnimationFrame(draw);
  }
  draw();
}

function dubResetRateLed() {
  const led = document.getElementById("dub-led-rate");
  if (led) { led.style.background = "#3a1010"; led.style.boxShadow = "inset 0 0 2px rgba(0,0,0,0.8)"; }
}

/* ------ Pads / banco / knobs ------ */
function dubRenderPads() {
  const preset = DUB_PRESETS[dubState.bank];
  document.querySelectorAll("#dub-pads .ds71-pad").forEach(p => {
    const i = parseInt(p.dataset.pad, 10);
    p.querySelector(".pad-wave").innerHTML = dubWaveSVG(preset[i].wave);
  });
}

function dubSetBankLeds() {
  const a = document.getElementById("dub-led-a");
  const b = document.getElementById("dub-led-b");
  const on = el => { el.style.background = "#30d158"; el.style.boxShadow = "0 0 6px #30d158"; };
  const off = el => { el.style.background = "#103a18"; el.style.boxShadow = "inset 0 0 2px rgba(0,0,0,0.8)"; };
  if (dubState.bank === 0) { on(a); off(b); } else { off(a); on(b); }
}

// Knob giratorio con arrastre vertical y rueda
function makeDubKnob(knobEl, norm0, onChange, format) {
  const face = knobEl.querySelector(".knob-face");
  const wrap = knobEl.closest(".knob-wrap");
  let valEl = wrap ? wrap.querySelector(".knob-val") : null;
  if (!valEl && wrap && format) {
    valEl = document.createElement("div");
    valEl.className = "knob-val";
    wrap.appendChild(valEl);
  }
  let norm = norm0;
  function render() {
    face.style.transform = `rotate(${-135 + norm * 270}deg)`;
    if (valEl && format) valEl.textContent = format(norm);
  }
  function setNorm(n) { norm = Math.max(0, Math.min(1, n)); render(); onChange(norm); }
  render();

  let dragging = false, startY = 0, startNorm = 0;
  knobEl.addEventListener("pointerdown", e => {
    dragging = true; startY = e.clientY; startNorm = norm;
    knobEl.setPointerCapture(e.pointerId); e.preventDefault();
  });
  knobEl.addEventListener("pointermove", e => {
    if (!dragging) return;
    setNorm(startNorm + (startY - e.clientY) / 200);
  });
  const end = e => { dragging = false; try { knobEl.releasePointerCapture(e.pointerId); } catch (er) {} };
  knobEl.addEventListener("pointerup", end);
  knobEl.addEventListener("pointercancel", end);
  knobEl.addEventListener("wheel", e => {
    e.preventDefault();
    setNorm(norm - Math.sign(e.deltaY) * 0.03);
  }, { passive: false });

  return { set: n => { norm = Math.max(0, Math.min(1, n)); render(); } };
}

function initDubControls() {
  // Knobs
  makeDubKnob(document.getElementById("dub-volume-knob"), 0.8, n => {
    dubState.volume = dubLinMap(n, 0, 1); dubApplyVolume();
  }, n => (n * 10).toFixed(1));
  makeDubKnob(document.getElementById("dub-decay-knob"), 0.35, n => {
    dubState.decay = n >= 0.985 ? Infinity : dubExpMap(n, 0.05, 4.0);
    // si hay un drone infinito sonando y bajas el DECAY, empieza a caer
    if (dubDroning && dubState.decay !== Infinity) dubRelease(false);
  }, n => n >= 0.985 ? "∞" : dubExpMap(n, 0.05, 4.0).toFixed(2) + " s");
  makeDubKnob(document.getElementById("dub-depth-knob"), 0.35, n => {
    dubState.depth = dubLinMap(n, 0, 1); dubApplyDepth();
  }, n => Math.round(n * 100) + " %");
  makeDubKnob(document.getElementById("dub-tune-knob"), 0.45, n => {
    dubState.tune = dubExpMap(n, 30, 9000); dubApplyTune();
  }, n => { const f = dubExpMap(n, 30, 9000); return f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : Math.round(f) + " Hz"; });
  makeDubKnob(document.getElementById("dub-sweep-knob"), 0.5, n => {
    dubState.sweep = n * 2 - 1;
  }, n => { const s = n * 2 - 1; return Math.abs(s) < 0.05 ? "FLAT" : (s < 0 ? "UP " : "DN ") + Math.round(Math.abs(s) * 100) + "%"; });
  makeDubKnob(document.getElementById("dub-rate-knob"), 0.4, n => {
    dubState.rate = dubExpMap(n, 0.1, 30); dubApplyRate();
  }, n => dubExpMap(n, 0.1, 30).toFixed(2) + " Hz");
  makeDubKnob(document.getElementById("dub-tone-knob"), 0.5, n => {
    dubState.toneDb = (n - 0.5) * 30; dubApplyTone();
  });
  makeDubKnob(document.getElementById("dub-trigsens-knob"), 0.5, () => {}); // decorativo (trigger externo no simulado)

  // Switch FILTER / FILTER+TUNE
  const sw = document.getElementById("dub-filtermode");
  sw.addEventListener("click", () => {
    dubState.filterMode = dubState.filterMode === "filter" ? "filtertune" : "filter";
    sw.querySelectorAll(".sw-opt").forEach(o => {
      o.classList.toggle("on", o.dataset.mode === (dubState.filterMode === "filter" ? "filter" : "filtertune"));
    });
  });

  // Banco A/B
  document.getElementById("dub-bank-btn").addEventListener("click", () => {
    dubState.bank = dubState.bank === 0 ? 1 : 0;
    dubSetBankLeds();
    dubRenderPads();
    if (dubIsPlaying && dubHeld) {
      const preset = DUB_PRESETS[dubState.bank][dubState.preset];
      const now = dubAudioCtx.currentTime;
      dubLfo.type = preset.wave;
      dubLfo.frequency.setValueAtTime(dubLfoRateHz(), now);
      dubLfoGain.gain.setValueAtTime(dubLfoDepthHz(), now);
    }
  });

  // Modo de disparo: Fijar (latch) / Mantener (hold)
  const trigmode = document.getElementById("dub-trigmode");
  trigmode.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      // al pasar a "mantener", soltar cualquier pad fijado
      if (btn.dataset.mode === "hold" && dubLatchedPad !== null) {
        dubRelease(); dubLatchedPad = null;
      }
      dubState.triggerMode = btn.dataset.mode;
      trigmode.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
    });
  });

  // Pads (triggers)
  document.querySelectorAll("#dub-pads .ds71-pad").forEach(pad => {
    const idx = parseInt(pad.dataset.pad, 10);
    pad.addEventListener("pointerdown", e => { e.preventDefault(); dubPadToggle(idx); });
    pad.addEventListener("pointerup", e => {
      if (dubState.triggerMode === "hold") { e.preventDefault(); dubRelease(); }
    });
    pad.addEventListener("pointerleave", () => {
      if (dubState.triggerMode === "hold" && dubHeldPad === idx) dubRelease();
    });
    pad.addEventListener("pointercancel", () => {
      if (dubState.triggerMode === "hold") dubRelease();
    });
  });

  // Teclado 1-4 (solo cuando la pestaña está visible)
  document.addEventListener("keydown", e => {
    const view = document.getElementById("module-dubsiren");
    if (!view || view.hidden || e.repeat) return;
    const idx = ["1", "2", "3", "4"].indexOf(e.key);
    if (idx >= 0) { e.preventDefault(); dubPadToggle(idx); }
  });
  document.addEventListener("keyup", e => {
    const view = document.getElementById("module-dubsiren");
    if (!view || view.hidden) return;
    const idx = ["1", "2", "3", "4"].indexOf(e.key);
    if (idx >= 0 && dubState.triggerMode === "hold" && dubHeldPad === idx) {
      e.preventDefault(); dubRelease();
    }
  });
}

/* ------ Init del módulo Dub Siren ------ */
function dubInit() {
  initDubControls();
  dubRenderPads();
  dubSetBankLeds();
  dubResetRateLed();
  setTimeout(() => dubClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", dubInit);


/* ============================================================
   ====== MÓDULO: RACK MULTIEFECTO (inspirado en Benidub) ======
   Fuente (tono/archivo) -> Digital Echo -> master -> analizadores -> salida
   Prototipo v1 (fase A1). Próximo: Phase, Spring, fuente DS71 y micro.
   ============================================================ */

let rackAudioCtx = null, rackMaster = null, rackAnalyserTime = null, rackAnalyserFreq = null;
let rackSourceGain = null;
let rackToneOsc = null, rackBufferSrc = null, rackBuffer = null;
let rackEcho = null, rackPhase = null, rackSpring = null;
let rackModules = [];       // efectos en orden dentro de la cadena
let rackOrder = ["echo", "phase", "spring"];  // orden actual de la cadena
const rackCardByKey = {};
const rackBypass = { echo: false, phase: false, spring: false };
let rackMicStream = null, rackMicSource = null;
let rackSirenVco = null, rackSirenLfo = null, rackSirenLfoGain = null;
const rackSirenState = { tune: 0.5, rate: 0.35, depth: 0.4, wave: "sine" };
let rackBackbone = false;   // grafo fijo creado

function rackSirenFreq() { return dubExpMap(rackSirenState.tune, 80, 2500); }
function rackSirenRateHz() { return dubExpMap(rackSirenState.rate, 0.1, 12); }
function rackSirenDepthHz() { return rackSirenState.depth * rackSirenFreq() * 0.9; }
let rackIsPlaying = false;  // hay generador sonando
let rackRafId = null;
const rackState = { sourceType: "tone" };

const rackEchoDefaults = { time: 0.42, fb: 0.38, mix: 0.42, hp: 0.15, lp: 0.78, mod: 0.15 };

function rackEnsureContext() {
  if (!rackAudioCtx) rackAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (rackAudioCtx.state === "suspended") rackAudioCtx.resume();
}

// Fábrica del Digital Echo: módulo con input/output y bypass
function makeRackEcho(ctx) {
  const input = ctx.createGain(), output = ctx.createGain();
  const bypassGain = ctx.createGain(); bypassGain.gain.value = 0;   // efecto activo
  const activeGain = ctx.createGain(); activeGain.gain.value = 1;
  const dry = ctx.createGain(), wet = ctx.createGain();
  const delay = ctx.createDelay(2.0);
  const fb = ctx.createGain();
  const hp = ctx.createBiquadFilter(); hp.type = "highpass";
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
  const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();

  // valores por defecto (coinciden con los knobs)
  delay.delayTime.value = dubExpMap(rackEchoDefaults.time, 0.07, 1.2);
  fb.gain.value = 0.92 * rackEchoDefaults.fb;
  dry.gain.value = 1 - rackEchoDefaults.mix;
  wet.gain.value = rackEchoDefaults.mix;
  hp.frequency.value = dubExpMap(rackEchoDefaults.hp, 20, 2000);
  lp.frequency.value = dubExpMap(rackEchoDefaults.lp, 200, 16000);
  lfo.type = "sine"; lfo.frequency.value = 0.4;
  lfoGain.gain.value = 0.006 * rackEchoDefaults.mod;

  // enrutado
  input.connect(bypassGain); bypassGain.connect(output);   // camino bypass
  input.connect(dry); dry.connect(activeGain);             // dry
  input.connect(delay);                                    // wet
  delay.connect(hp); hp.connect(lp);
  lp.connect(wet); wet.connect(activeGain);
  lp.connect(fb); fb.connect(delay);                       // realimentación (con filtros)
  activeGain.connect(output);
  lfo.connect(lfoGain); lfoGain.connect(delay.delayTime);  // wow
  lfo.start();

  return {
    input, output, nodes: { delay, fb, hp, lp, lfo, lfoGain, dry, wet },
    bypassed: false,
    setBypass(b) { this.bypassed = b; bypassGain.gain.value = b ? 1 : 0; activeGain.gain.value = b ? 0 : 1; }
  };
}

// Phaser óptico (cadena de filtros all-pass modulados por LFO)
const rackPhaseDefaults = { rate: 0.35, depth: 0.4, centre: 0.45, fb: 0.3 };
function makeRackPhase(ctx) {
  const input = ctx.createGain(), output = ctx.createGain();
  const bypassGain = ctx.createGain(); bypassGain.gain.value = 0;
  const activeGain = ctx.createGain(); activeGain.gain.value = 1;
  const dry = ctx.createGain(); dry.gain.value = 0.5;
  const wet = ctx.createGain(); wet.gain.value = 0.5;
  const stages = []; const N = 6;
  for (let i = 0; i < N; i++) {
    const ap = ctx.createBiquadFilter(); ap.type = "allpass";
    ap.frequency.value = dubExpMap(rackPhaseDefaults.centre, 200, 2000); ap.Q.value = 1;
    stages.push(ap);
  }
  const fb = ctx.createGain(); fb.gain.value = 0.7 * rackPhaseDefaults.fb;
  const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = dubExpMap(rackPhaseDefaults.rate, 0.05, 8);
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 1500 * rackPhaseDefaults.depth;

  input.connect(bypassGain); bypassGain.connect(output);
  input.connect(dry); dry.connect(activeGain);
  input.connect(stages[0]);
  for (let i = 0; i < N - 1; i++) stages[i].connect(stages[i + 1]);
  stages[N - 1].connect(wet); wet.connect(activeGain);
  stages[N - 1].connect(fb); fb.connect(stages[0]);
  activeGain.connect(output);
  lfo.connect(lfoGain); stages.forEach(ap => lfoGain.connect(ap.frequency));
  lfo.start();

  return {
    input, output, nodes: { stages, fb, lfo, lfoGain }, bypassed: false,
    setBypass(b) { this.bypassed = b; bypassGain.gain.value = b ? 1 : 0; activeGain.gain.value = b ? 0 : 1; }
  };
}

// Respuesta de impulso sintética de reverb de muelles (ruido con caída + "boing")
function makeSpringIR(ctx) {
  const dur = 2.2, sr = ctx.sampleRate, len = Math.floor(dur * sr);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 4.5);
      let s = (Math.random() * 2 - 1) * env;
      s += Math.sin(2 * Math.PI * (1200 + t * 3000) * t) * env * 0.25 * Math.exp(-t * 8); // chirp de muelle
      d[i] = s;
    }
  }
  return buf;
}

// Spring Amp III (reverb de muelles + filtro con LFO)
const rackSpringDefaults = { mix: 0.4, cutoff: 0.6, reso: 0.2, rate: 0.3, depth: 0.0 };
function makeRackSpring(ctx) {
  const input = ctx.createGain(), output = ctx.createGain();
  const bypassGain = ctx.createGain(); bypassGain.gain.value = 0;
  const activeGain = ctx.createGain(); activeGain.gain.value = 1;
  const dry = ctx.createGain(); dry.gain.value = 0.85;
  const filter = ctx.createBiquadFilter(); filter.type = "lowpass";
  filter.frequency.value = dubExpMap(rackSpringDefaults.cutoff, 200, 12000);
  filter.Q.value = dubLinMap(rackSpringDefaults.reso, 0.5, 15);
  const conv = ctx.createConvolver(); conv.buffer = makeSpringIR(ctx);
  const rev = ctx.createGain(); rev.gain.value = rackSpringDefaults.mix;
  const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = dubExpMap(rackSpringDefaults.rate, 0.05, 8);
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 3000 * rackSpringDefaults.depth;

  input.connect(bypassGain); bypassGain.connect(output);
  input.connect(dry); dry.connect(activeGain);
  input.connect(filter); filter.connect(conv); conv.connect(rev); rev.connect(activeGain);
  activeGain.connect(output);
  lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start();

  return {
    input, output, nodes: { filter, conv, rev, lfo, lfoGain }, bypassed: false,
    setBypass(b) { this.bypassed = b; bypassGain.gain.value = b ? 1 : 0; activeGain.gain.value = b ? 0 : 1; }
  };
}

function rackModuleByKey(k) { return k === "echo" ? rackEcho : k === "phase" ? rackPhase : rackSpring; }

// Conecta la cadena en el orden actual (rackOrder)
function rackReconnect() {
  try { rackSourceGain.disconnect(); } catch (e) {}
  rackOrder.forEach(k => { const m = rackModuleByKey(k); if (m) { try { m.output.disconnect(); } catch (e) {} } });
  let prev = rackSourceGain;
  for (const k of rackOrder) { const m = rackModuleByKey(k); prev.connect(m.input); prev = m.output; }
  prev.connect(rackMaster);
}

// Reordena un módulo en la cadena (dir = -1 arriba, +1 abajo)
function rackMoveModule(key, dir) {
  const i = rackOrder.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= rackOrder.length) return;
  rackOrder[i] = rackOrder[j]; rackOrder[j] = key;
  const parent = rackCardByKey[rackOrder[0]].parentNode;
  rackOrder.forEach(k => parent.appendChild(rackCardByKey[k]));  // reordena las cards
  if (rackBackbone) rackReconnect();
}

function rackBuildBackbone() {
  if (rackBackbone) return;
  rackEnsureContext();
  const ctx = rackAudioCtx;
  rackSourceGain = ctx.createGain(); rackSourceGain.gain.value = 0.9;
  rackMaster = ctx.createGain(); rackMaster.gain.value = 0.9;
  rackAnalyserTime = ctx.createAnalyser(); rackAnalyserTime.fftSize = 2048;
  rackAnalyserFreq = ctx.createAnalyser(); rackAnalyserFreq.fftSize = 2048;
  rackEcho = makeRackEcho(ctx);
  rackPhase = makeRackPhase(ctx);
  rackSpring = makeRackSpring(ctx);
  rackModules = [rackEcho, rackPhase, rackSpring];

  // salida: master -> analizadores + destino
  rackMaster.connect(rackAnalyserTime);
  rackMaster.connect(rackAnalyserFreq);
  rackMaster.connect(ctx.destination);
  // cadena: fuente -> echo -> phase -> spring -> master
  rackReconnect();
  rackEcho.setBypass(rackBypass.echo);
  rackPhase.setBypass(rackBypass.phase);
  rackSpring.setBypass(rackBypass.spring);
  rackBackbone = true;
}

function rackStopGenerator() {
  if (rackToneOsc) { try { rackToneOsc.stop(); } catch (e) {} try { rackToneOsc.disconnect(); } catch (e) {} rackToneOsc = null; }
  if (rackBufferSrc) { try { rackBufferSrc.stop(); } catch (e) {} try { rackBufferSrc.disconnect(); } catch (e) {} rackBufferSrc = null; }
  if (rackMicSource) { try { rackMicSource.disconnect(); } catch (e) {} rackMicSource = null; }
  if (rackSirenVco) { try { rackSirenVco.stop(); } catch (e) {} try { rackSirenVco.disconnect(); } catch (e) {} rackSirenVco = null; }
  if (rackSirenLfo) { try { rackSirenLfo.stop(); } catch (e) {} try { rackSirenLfo.disconnect(); } catch (e) {} rackSirenLfo = null; }
  rackSirenLfoGain = null;
}

function rackStartGenerator() {
  const ctx = rackAudioCtx;
  rackStopGenerator();
  if (rackState.sourceType === "siren") {
    rackSirenVco = ctx.createOscillator(); rackSirenVco.type = "sawtooth";
    rackSirenVco.frequency.value = rackSirenFreq();
    rackSirenLfo = ctx.createOscillator(); rackSirenLfo.type = rackSirenState.wave;
    rackSirenLfo.frequency.value = rackSirenRateHz();
    rackSirenLfoGain = ctx.createGain(); rackSirenLfoGain.gain.value = rackSirenDepthHz();
    const g = ctx.createGain(); g.gain.value = 0.3;
    rackSirenLfo.connect(rackSirenLfoGain); rackSirenLfoGain.connect(rackSirenVco.frequency);
    rackSirenVco.connect(g); g.connect(rackSourceGain);
    rackSirenVco.start(); rackSirenLfo.start();
  } else if (rackState.sourceType === "mic" && rackMicStream) {
    rackMicSource = ctx.createMediaStreamSource(rackMicStream);
    rackMicSource.connect(rackSourceGain);
  } else if (rackState.sourceType === "file" && rackBuffer) {
    rackBufferSrc = ctx.createBufferSource();
    rackBufferSrc.buffer = rackBuffer;
    rackBufferSrc.loop = true;
    rackBufferSrc.connect(rackSourceGain);
    rackBufferSrc.start();
  } else {
    // tono de prueba (sierra 220 Hz, nivel moderado)
    rackToneOsc = ctx.createOscillator();
    rackToneOsc.type = "sawtooth";
    rackToneOsc.frequency.value = 220;
    const g = ctx.createGain(); g.gain.value = 0.25;
    rackToneOsc.connect(g); g.connect(rackSourceGain);
    rackToneOsc.start();
  }
}

function rackPlay() {
  rackEnsureContext();
  rackBuildBackbone();
  rackStartGenerator();
  rackIsPlaying = true;
  rackUpdatePlayButton();
  rackStartVisualLoop();
}

function rackStop() {
  rackStopGenerator();
  rackIsPlaying = false;
  rackUpdatePlayButton();
  if (rackRafId) cancelAnimationFrame(rackRafId);
  rackClearCanvases();
}

function rackTeardown() {
  rackStop();
  // el backbone se conserva entre visitas a la pestaña; solo paramos el sonido
}

function rackUpdatePlayButton() {
  const btn = document.getElementById("rack-play-btn");
  if (!btn) return;
  btn.classList.toggle("playing", rackIsPlaying);
  document.getElementById("rack-play-icon").innerHTML = rackIsPlaying ? "&#9632;" : "&#9658;";
  document.getElementById("rack-play-label").textContent = rackIsPlaying ? t("rack_stop") : t("rack_play");
}

function rackClearCanvases() {
  ["rack-oscilloscope", "rack-spectrum"].forEach(id => {
    const c = document.getElementById(id); if (!c) return;
    const { ctx, width, height } = setupCanvas(c);
    ctx.clearRect(0, 0, width, height); drawGrid(ctx, width, height);
  });
}

function rackStartVisualLoop() {
  const oscSetup = setupCanvas(document.getElementById("rack-oscilloscope"));
  const fftSetup = setupCanvas(document.getElementById("rack-spectrum"));
  const timeData = new Uint8Array(rackAnalyserTime.fftSize);
  const freqData = new Uint8Array(rackAnalyserFreq.frequencyBinCount);
  function draw() {
    if (!rackIsPlaying) return;
    rackAnalyserTime.getByteTimeDomainData(timeData);
    drawOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, timeData);
    rackAnalyserFreq.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);
    rackRafId = requestAnimationFrame(draw);
  }
  draw();
}

// Cambiar tipo de fuente
function rackUpdateSourceButtons() {
  document.getElementById("rack-tone-btn").classList.toggle("active", rackState.sourceType === "tone");
  const fileLabel = document.querySelector('label[for="rack-file-input"]');
  if (fileLabel) fileLabel.classList.toggle("active", rackState.sourceType === "file");
  const mic = document.getElementById("rack-mic-btn");
  if (mic) mic.classList.toggle("active", rackState.sourceType === "mic");
  const siren = document.getElementById("rack-siren-btn");
  if (siren) siren.classList.toggle("active", rackState.sourceType === "siren");
  const sirenPanel = document.getElementById("rack-siren-panel");
  if (sirenPanel) sirenPanel.hidden = rackState.sourceType !== "siren";
}

function rackSetSource(type) {
  rackState.sourceType = type;
  rackUpdateSourceButtons();
  if (rackIsPlaying) rackStartGenerator();
}

// Micrófono (pide permiso; guarda el stream para reutilizar)
function rackEnableMic() {
  rackEnsureContext();
  if (rackMicStream) { rackSetSource("mic"); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    .then(stream => { rackMicStream = stream; rackSetSource("mic"); })
    .catch(() => {
      const el = document.getElementById("rack-filename");
      el.removeAttribute("data-i18n");
      el.textContent = "⚠ micrófono no disponible";
    });
}

// Cargar archivo de audio
function rackLoadFile(file) {
  rackEnsureContext();
  const reader = new FileReader();
  reader.onload = () => {
    rackAudioCtx.decodeAudioData(reader.result)
      .then(buf => {
        rackBuffer = buf;
        const el = document.getElementById("rack-filename");
        el.removeAttribute("data-i18n");
        el.textContent = file.name;
        rackSetSource("file");
      })
      .catch(() => {
        const el = document.getElementById("rack-filename");
        el.removeAttribute("data-i18n");
        el.textContent = "⚠ " + file.name;
      });
  };
  reader.readAsArrayBuffer(file);
}

function initRackControls() {
  // Botón reproducir/parar
  document.getElementById("rack-play-btn").addEventListener("click", () => {
    if (rackIsPlaying) rackStop(); else rackPlay();
  });

  // Selector de fuente
  document.getElementById("rack-tone-btn").addEventListener("click", () => rackSetSource("tone"));
  document.getElementById("rack-file-input").addEventListener("change", e => {
    if (e.target.files && e.target.files[0]) rackLoadFile(e.target.files[0]);
  });
  const micBtn = document.getElementById("rack-mic-btn");
  if (micBtn) micBtn.addEventListener("click", () => rackEnableMic());
  const sirenBtn = document.getElementById("rack-siren-btn");
  if (sirenBtn) sirenBtn.addEventListener("click", () => rackSetSource("siren"));

  // Sirena: selector de onda del LFO + knobs
  const sirenWaves = document.getElementById("rack-siren-waves");
  if (sirenWaves) {
    sirenWaves.querySelectorAll(".rack-wave-btn").forEach(btn => {
      btn.innerHTML = dubWaveSVG(btn.dataset.wave);
      btn.addEventListener("click", () => {
        rackSirenState.wave = btn.dataset.wave;
        sirenWaves.querySelectorAll(".rack-wave-btn").forEach(b => b.classList.toggle("active", b === btn));
        if (rackSirenLfo) rackSirenLfo.type = rackSirenState.wave;
      });
    });
  }
  makeDubKnob(document.getElementById("rack-siren-tune-knob"), rackSirenState.tune, n => {
    rackSirenState.tune = n;
    if (rackSirenVco) { const now = rackAudioCtx.currentTime; rackSirenVco.frequency.setTargetAtTime(rackSirenFreq(), now, 0.02); rackSirenLfoGain.gain.setTargetAtTime(rackSirenDepthHz(), now, 0.02); }
  }, n => { const f = dubExpMap(n, 80, 2500); return f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : Math.round(f) + " Hz"; });
  makeDubKnob(document.getElementById("rack-siren-rate-knob"), rackSirenState.rate, n => {
    rackSirenState.rate = n;
    if (rackSirenLfo) rackSirenLfo.frequency.setTargetAtTime(rackSirenRateHz(), rackAudioCtx.currentTime, 0.02);
  }, n => dubExpMap(n, 0.1, 12).toFixed(2) + " Hz");
  makeDubKnob(document.getElementById("rack-siren-depth-knob"), rackSirenState.depth, n => {
    rackSirenState.depth = n;
    if (rackSirenLfoGain) rackSirenLfoGain.gain.setTargetAtTime(rackSirenDepthHz(), rackAudioCtx.currentTime, 0.02);
  }, n => Math.round(n * 100) + " %");

  // Reordenar módulos: botones ▲▼ en cada cabecera
  ["echo", "phase", "spring"].forEach(key => {
    const card = document.querySelector(`#module-rack [data-effect="${key}"]`);
    if (!card) return;
    rackCardByKey[key] = card;
    const head = card.querySelector(".rack-module-head");
    const bypass = head.querySelector(".rack-bypass");
    const ctrl = document.createElement("div");
    ctrl.className = "rack-reorder";
    ctrl.innerHTML = '<button data-dir="-1" aria-label="subir">&#9650;</button><button data-dir="1" aria-label="bajar">&#9660;</button>';
    const right = document.createElement("div");
    right.style.display = "flex"; right.style.alignItems = "center"; right.style.gap = "8px";
    right.appendChild(ctrl); right.appendChild(bypass);
    head.appendChild(right);
    ctrl.querySelectorAll("button").forEach(b =>
      b.addEventListener("click", () => rackMoveModule(key, parseInt(b.dataset.dir, 10))));
  });

  // Bypass de cada módulo (recuerda el estado aunque aún no exista el grafo)
  const rackModuleOf = key => key === "echo" ? rackEcho : key === "phase" ? rackPhase : rackSpring;
  [["rack-echo-bypass", "echo"], ["rack-phase-bypass", "phase"], ["rack-spring-bypass", "spring"]]
    .forEach(([btnId, key]) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.addEventListener("click", () => {
        rackBypass[key] = !rackBypass[key];
        const mod = rackModuleOf(key);
        if (mod) mod.setBypass(rackBypass[key]);
        btn.classList.toggle("on", rackBypass[key]);
      });
    });

  // Knobs del Echo (los nodos existen tras rackBuildBackbone; guardas por si aún no)
  const D = rackEchoDefaults;
  const fmtHz = n => { const f = dubExpMap(n, 20, 2000); return f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : Math.round(f) + " Hz"; };
  const fmtHz2 = n => { const f = dubExpMap(n, 200, 16000); return f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : Math.round(f) + " Hz"; };
  makeDubKnob(document.getElementById("rack-echo-time-knob"), D.time, n => {
    if (rackEcho) rackEcho.nodes.delay.delayTime.setTargetAtTime(dubExpMap(n, 0.07, 1.2), rackAudioCtx.currentTime, 0.03);
  }, n => (dubExpMap(n, 0.07, 1.2) * 1000).toFixed(0) + " ms");
  makeDubKnob(document.getElementById("rack-echo-fb-knob"), D.fb, n => {
    if (rackEcho) rackEcho.nodes.fb.gain.setTargetAtTime(0.92 * n, rackAudioCtx.currentTime, 0.02);
  }, n => Math.round(n * 100) + " %");
  makeDubKnob(document.getElementById("rack-echo-mix-knob"), D.mix, n => {
    if (rackEcho) {
      const now = rackAudioCtx.currentTime;
      rackEcho.nodes.dry.gain.setTargetAtTime(1 - n, now, 0.02);
      rackEcho.nodes.wet.gain.setTargetAtTime(n, now, 0.02);
    }
  }, n => Math.round(n * 100) + "% wet");
  makeDubKnob(document.getElementById("rack-echo-hp-knob"), D.hp, n => {
    if (rackEcho) rackEcho.nodes.hp.frequency.setTargetAtTime(dubExpMap(n, 20, 2000), rackAudioCtx.currentTime, 0.02);
  }, fmtHz);
  makeDubKnob(document.getElementById("rack-echo-lp-knob"), D.lp, n => {
    if (rackEcho) rackEcho.nodes.lp.frequency.setTargetAtTime(dubExpMap(n, 200, 16000), rackAudioCtx.currentTime, 0.02);
  }, fmtHz2);
  makeDubKnob(document.getElementById("rack-echo-depth-knob"), D.mod, n => {
    if (rackEcho) rackEcho.nodes.lfoGain.gain.setTargetAtTime(0.006 * n, rackAudioCtx.currentTime, 0.02);
  }, n => Math.round(n * 100) + " %");

  // Knobs del Phase
  const P = rackPhaseDefaults;
  makeDubKnob(document.getElementById("rack-phase-rate-knob"), P.rate, n => {
    if (rackPhase) rackPhase.nodes.lfo.frequency.setTargetAtTime(dubExpMap(n, 0.05, 8), rackAudioCtx.currentTime, 0.02);
  }, n => dubExpMap(n, 0.05, 8).toFixed(2) + " Hz");
  makeDubKnob(document.getElementById("rack-phase-depth-knob"), P.depth, n => {
    if (rackPhase) rackPhase.nodes.lfoGain.gain.setTargetAtTime(1500 * n, rackAudioCtx.currentTime, 0.02);
  }, n => Math.round(n * 100) + " %");
  makeDubKnob(document.getElementById("rack-phase-centre-knob"), P.centre, n => {
    if (rackPhase) { const f = dubExpMap(n, 200, 2000), now = rackAudioCtx.currentTime; rackPhase.nodes.stages.forEach(ap => ap.frequency.setTargetAtTime(f, now, 0.02)); }
  }, n => Math.round(dubExpMap(n, 200, 2000)) + " Hz");
  makeDubKnob(document.getElementById("rack-phase-fb-knob"), P.fb, n => {
    if (rackPhase) rackPhase.nodes.fb.gain.setTargetAtTime(0.7 * n, rackAudioCtx.currentTime, 0.02);
  }, n => Math.round(n * 100) + " %");

  // Knobs del Spring Amp III
  const S = rackSpringDefaults;
  makeDubKnob(document.getElementById("rack-spring-mix-knob"), S.mix, n => {
    if (rackSpring) rackSpring.nodes.rev.gain.setTargetAtTime(n, rackAudioCtx.currentTime, 0.02);
  }, n => Math.round(n * 100) + " %");
  makeDubKnob(document.getElementById("rack-spring-cutoff-knob"), S.cutoff, n => {
    if (rackSpring) rackSpring.nodes.filter.frequency.setTargetAtTime(dubExpMap(n, 200, 12000), rackAudioCtx.currentTime, 0.02);
  }, n => { const f = dubExpMap(n, 200, 12000); return f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : Math.round(f) + " Hz"; });
  makeDubKnob(document.getElementById("rack-spring-reso-knob"), S.reso, n => {
    if (rackSpring) rackSpring.nodes.filter.Q.setTargetAtTime(dubLinMap(n, 0.5, 15), rackAudioCtx.currentTime, 0.02);
  }, n => "Q " + dubLinMap(n, 0.5, 15).toFixed(1));
  makeDubKnob(document.getElementById("rack-spring-rate-knob"), S.rate, n => {
    if (rackSpring) rackSpring.nodes.lfo.frequency.setTargetAtTime(dubExpMap(n, 0.05, 8), rackAudioCtx.currentTime, 0.02);
  }, n => dubExpMap(n, 0.05, 8).toFixed(2) + " Hz");
  makeDubKnob(document.getElementById("rack-spring-depth-knob"), S.depth, n => {
    if (rackSpring) rackSpring.nodes.lfoGain.gain.setTargetAtTime(3000 * n, rackAudioCtx.currentTime, 0.02);
  }, n => Math.round(n * 100) + " %");
}

function rackInit() {
  initRackControls();
  setTimeout(() => rackClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", rackInit);




/* ============================================================
   ====== MÓDULO: LOOPER (sampler sincronizado a tempo) ======
   8 pistas de loop sincronizadas: BPM + longitud en compases, count-in
   con reloj visual, grabación cuantizada y loops que encajan a compás.
   (Mantiene los ids smp-* del HTML y los nombres que usa el sistema de tabs.)
   ============================================================ */

let smpAudioCtx = null, smpMaster = null, smpAnalyser = null, smpRafId = null, smpVisualRunning = false;
const smpPads = Array.from({ length: 8 }, () => ({ buffer: null, name: null, active: false, source: null }));
let smpMediaStream = null, smpRecorder = null, smpRecChunks = [], smpRecPad = -1, smpLoadTarget = -1;

// Transporte
let lpBpm = 90, lpBars = 2, lpPlaying = false, lpMetro = true;
let lpStartTime = 0, lpSchedTimer = null, lpNextBeat = 0, lpBeatCount = 0;
let lpArmedPad = -1, lpRecStartTimer = null, lpRecStopTimer = null;

function lpLoopLen() { return lpBars * 4 * 60 / lpBpm; }
function lpBeatLen() { return 60 / lpBpm; }
function smpPadEl(i) { return document.querySelector(`#smp-pads .smp-pad[data-pad="${i}"]`); }

function smpEnsureContext() {
  if (!smpAudioCtx) {
    smpAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    smpMaster = smpAudioCtx.createGain(); smpMaster.gain.value = 0.9;
    smpAnalyser = smpAudioCtx.createAnalyser(); smpAnalyser.fftSize = 2048;
    smpMaster.connect(smpAnalyser);
    smpMaster.connect(smpAudioCtx.destination);
  }
  if (smpAudioCtx.state === "suspended") smpAudioCtx.resume();
}

function smpGetMic() {
  if (smpMediaStream) return Promise.resolve(smpMediaStream);
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject();
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } }).then(s => { smpMediaStream = s; return s; });
}

/* ------ Transporte ------ */
function lpNextLoopStart() {
  const L = lpLoopLen(); let t = lpStartTime;
  while (t < smpAudioCtx.currentTime + 0.03) t += L;
  return t;
}

function lpStart() {
  smpEnsureContext();
  if (lpPlaying) return;
  lpPlaying = true;
  const now = smpAudioCtx.currentTime;
  lpStartTime = now; lpNextBeat = now; lpBeatCount = 0;
  lpScheduler();
  lpSchedTimer = setInterval(lpScheduler, 25);
  smpPads.forEach((p, i) => { if (p.active && p.buffer) lpStartLoopSource(i, lpStartTime); });
  smpStartVisual();
  lpUpdatePlayBtn();
}

function lpStop() {
  lpPlaying = false;
  if (lpSchedTimer) { clearInterval(lpSchedTimer); lpSchedTimer = null; }
  smpPads.forEach((p, i) => lpStopLoopSource(i));
  lpCancelRecord();
  smpStopVisual(); smpClearCanvases();
  lpUpdatePlayBtn();
}

function lpScheduler() {
  const ctx = smpAudioCtx, ahead = 0.12;
  while (lpNextBeat < ctx.currentTime + ahead) {
    if (lpMetro) lpClick(lpNextBeat, (lpBeatCount % (lpBars * 4)) === 0);
    lpNextBeat += lpBeatLen(); lpBeatCount++;
  }
  while (ctx.currentTime - lpStartTime >= lpLoopLen()) lpStartTime += lpLoopLen();
}

function lpClick(time, accent) {
  const o = smpAudioCtx.createOscillator(), g = smpAudioCtx.createGain();
  o.frequency.value = accent ? 1500 : 900;
  o.connect(g); g.connect(smpAudioCtx.destination);
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(accent ? 0.4 : 0.18, time + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  o.start(time); o.stop(time + 0.06);
}

/* ------ Loops ------ */
function lpStartLoopSource(i, when) {
  lpStopLoopSource(i);
  const p = smpPads[i];
  if (!p.buffer) return;
  const src = smpAudioCtx.createBufferSource();
  src.buffer = p.buffer; src.loop = true;
  src.loopStart = 0; src.loopEnd = Math.min(p.buffer.duration, lpLoopLen());
  src.connect(smpMaster);
  src.start(when);
  p.source = src;
}
function lpStopLoopSource(i) {
  const p = smpPads[i];
  if (p.source) { try { p.source.stop(); } catch (e) {} try { p.source.disconnect(); } catch (e) {} p.source = null; }
}

// Clic/tecla en un pad = activar/silenciar su loop (entra a compás)
function smpPlayPad(i) {
  if (!smpPads[i].buffer) return;
  smpEnsureContext();
  if (!lpPlaying) lpStart();
  smpPads[i].active = !smpPads[i].active;
  smpPadEl(i).classList.toggle("playing", smpPads[i].active);
  if (smpPads[i].active) lpStartLoopSource(i, lpNextLoopStart());
  else lpStopLoopSource(i);
}

/* ------ Grabación cuantizada ------ */
function smpToggleRecord(i) {
  if (lpArmedPad === i || smpRecPad === i) { lpCancelRecord(); return; }
  smpEnsureContext();
  if (!lpPlaying) lpStart();
  smpGetMic().then(stream => {
    lpArmedPad = i;
    smpPadEl(i).classList.add("armed");
    smpRecorder = new MediaRecorder(stream);
    smpRecChunks = [];
    smpRecorder.ondataavailable = e => { if (e.data.size) smpRecChunks.push(e.data); };
    smpRecorder.onstop = () => lpFinishRecord(i);
    const startAt = lpNextLoopStart();
    const delayMs = Math.max(0, (startAt - smpAudioCtx.currentTime) * 1000);
    lpRecStartTimer = setTimeout(() => {
      if (lpArmedPad !== i) return;
      smpRecorder.start();
      smpRecPad = i; lpArmedPad = -1;
      const pad = smpPadEl(i);
      pad.classList.remove("armed"); pad.classList.add("recording");
      pad.querySelector(".smp-rec").classList.add("recording");
      const nameEl = pad.querySelector(".smp-pad-name");
      nameEl.removeAttribute("data-i18n"); nameEl.textContent = t("smp_recording");
      lpRecStopTimer = setTimeout(() => { if (smpRecorder && smpRecorder.state === "recording") smpRecorder.stop(); }, lpLoopLen() * 1000);
    }, delayMs);
  }).catch(() => {
    const nameEl = smpPadEl(i).querySelector(".smp-pad-name");
    nameEl.removeAttribute("data-i18n"); nameEl.textContent = t("smp_mic_denied");
    lpArmedPad = -1; smpPadEl(i).classList.remove("armed");
  });
}

function lpCancelRecord() {
  clearTimeout(lpRecStartTimer); clearTimeout(lpRecStopTimer);
  if (smpRecorder && smpRecorder.state === "recording") { try { smpRecorder.stop(); } catch (e) {} }
  if (lpArmedPad >= 0) smpPadEl(lpArmedPad).classList.remove("armed");
  lpArmedPad = -1;
}

function lpFinishRecord(i) {
  const pad = smpPadEl(i);
  pad.classList.remove("recording");
  pad.querySelector(".smp-rec").classList.remove("recording");
  const blob = new Blob(smpRecChunks, { type: smpRecorder.mimeType || "audio/webm" });
  smpRecPad = -1;
  blob.arrayBuffer()
    .then(ab => smpAudioCtx.decodeAudioData(ab))
    .then(buf => {
      const L = lpLoopLen(), sr = buf.sampleRate, wanted = Math.floor(L * sr);
      // Buffer MONO de duración exacta al compás. Mono se reparte a L+R (centrado);
      // así se evita que el micro (mono grabado en estéreo) suene solo por un canal.
      const out = smpAudioCtx.createBuffer(1, wanted, sr);
      const dst = out.getChannelData(0);
      const nCh = buf.numberOfChannels;
      const copyN = Math.min(buf.length, wanted);
      if (nCh === 1) {
        dst.set(buf.getChannelData(0).subarray(0, copyN));
      } else {
        // elegir el canal con más energía (el micro mono suele dejar el otro vacío)
        let best = 0, bestE = -1;
        for (let ch = 0; ch < nCh; ch++) {
          const c = buf.getChannelData(ch); let e = 0;
          for (let n = 0; n < copyN; n += 64) e += c[n] * c[n];
          if (e > bestE) { bestE = e; best = ch; }
        }
        dst.set(buf.getChannelData(best).subarray(0, copyN));
      }
      smpAssign(i, out, "LOOP " + (i + 1));
      smpPads[i].active = true; pad.classList.add("playing");
      lpStartLoopSource(i, lpNextLoopStart());
    })
    .catch(() => {});
}

function smpAssign(i, buffer, name) {
  smpPads[i].buffer = buffer; smpPads[i].name = name;
  const pad = smpPadEl(i);
  pad.classList.add("has-sample");
  const nameEl = pad.querySelector(".smp-pad-name");
  nameEl.removeAttribute("data-i18n"); nameEl.textContent = name;
}

function smpClearPad(i) {
  lpStopLoopSource(i);
  smpPads[i] = { buffer: null, name: null, active: false, source: null };
  const pad = smpPadEl(i);
  pad.classList.remove("has-sample", "playing");
  const nameEl = pad.querySelector(".smp-pad-name");
  nameEl.setAttribute("data-i18n", "smp_empty"); nameEl.textContent = t("smp_empty");
}

function smpLoadFileFor(i, file) {
  smpEnsureContext();
  file.arrayBuffer()
    .then(ab => smpAudioCtx.decodeAudioData(ab))
    .then(buf => { smpAssign(i, buf, file.name); if (lpPlaying) { smpPads[i].active = true; smpPadEl(i).classList.add("playing"); lpStartLoopSource(i, lpNextLoopStart()); } })
    .catch(() => {});
}

/* ------ Visual (osciloscopio + reloj) ------ */
function lpDrawClock(pos, countdown, beat) {
  const c = document.getElementById("lp-clock"); if (!c) return;
  const { ctx, width, height } = setupCanvas(c);
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2, cy = height / 2, r = Math.min(cx, cy) - 5;
  if (r <= 0) return;   // canvas aún sin tamaño (pestaña oculta): nada que dibujar
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.strokeStyle = getCssVar("--grid-line"); ctx.lineWidth = 3; ctx.stroke();
  const col = countdown != null ? getCssVar("--accent4") : getCssVar("--accent3");
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * pos); ctx.closePath();
  ctx.globalAlpha = 0.28; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = getCssVar("--text"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "700 22px -apple-system, sans-serif";
  ctx.fillText(countdown != null ? String(countdown) : String(beat), cx, cy);
}

function smpStartVisual() {
  smpVisualRunning = true;
  const oscSetup = setupCanvas(document.getElementById("smp-oscilloscope"));
  const timeData = new Uint8Array(smpAnalyser.fftSize);
  function draw() {
    if (!smpVisualRunning) return;
    smpAnalyser.getByteTimeDomainData(timeData);
    drawOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, timeData);
    const L = lpLoopLen();
    const pos = lpPlaying ? (((smpAudioCtx.currentTime - lpStartTime) % L) / L) : 0;
    let countdown = null;
    if (lpArmedPad >= 0) { const next = lpNextLoopStart(); countdown = Math.max(1, Math.ceil((next - smpAudioCtx.currentTime) / lpBeatLen())); }
    const beat = (Math.floor(pos * lpBars * 4) % (lpBars * 4)) + 1;
    lpDrawClock(pos, countdown, beat);
    smpRafId = requestAnimationFrame(draw);
  }
  draw();
}

function smpStopVisual() {
  smpVisualRunning = false;
  if (smpRafId) cancelAnimationFrame(smpRafId);
}

function smpClearCanvases() {
  const c = document.getElementById("smp-oscilloscope");
  if (c) { const { ctx, width, height } = setupCanvas(c); ctx.clearRect(0, 0, width, height); drawGrid(ctx, width, height); }
  lpDrawClock(0, null, 1);
}

function smpOnLeave() { lpStop(); }

function lpUpdatePlayBtn() {
  const btn = document.getElementById("lp-play-btn");
  if (!btn) return;
  btn.classList.toggle("playing", lpPlaying);
  document.getElementById("lp-play-icon").innerHTML = lpPlaying ? "&#9632;" : "&#9658;";
  document.getElementById("lp-play-label").textContent = lpPlaying ? t("rack_stop") : t("lp_play");
}

/* ------ Controles ------ */
function initSamplerControls() {
  document.querySelectorAll("#smp-pads .smp-pad").forEach(pad => {
    const i = parseInt(pad.dataset.pad, 10);
    pad.querySelector(".smp-pad-body").addEventListener("pointerdown", e => { e.preventDefault(); smpPlayPad(i); });
    pad.querySelector(".smp-rec").addEventListener("click", () => smpToggleRecord(i));
    pad.querySelector(".smp-load").addEventListener("click", () => { smpLoadTarget = i; document.getElementById("smp-file-input").click(); });
    pad.querySelector(".smp-clear").addEventListener("click", () => smpClearPad(i));
  });
  document.getElementById("smp-file-input").addEventListener("change", e => {
    if (e.target.files && e.target.files[0] && smpLoadTarget >= 0) smpLoadFileFor(smpLoadTarget, e.target.files[0]);
    e.target.value = "";
  });

  // Transporte
  document.getElementById("lp-play-btn").addEventListener("click", () => { if (lpPlaying) lpStop(); else lpStart(); });
  const bpm = document.getElementById("lp-bpm");
  bpm.addEventListener("input", () => {
    lpBpm = parseInt(bpm.value, 10);
    document.getElementById("lp-bpm-val").textContent = lpBpm;
    lpResyncActive();
  });
  document.querySelectorAll("#lp-bars button").forEach(b => {
    b.addEventListener("click", () => {
      lpBars = parseInt(b.dataset.bars, 10);
      document.querySelectorAll("#lp-bars button").forEach(x => x.classList.toggle("active", x === b));
      lpResyncActive();
    });
  });
  const metro = document.getElementById("lp-metro-btn");
  metro.classList.add("active");
  metro.addEventListener("click", () => { lpMetro = !lpMetro; metro.classList.toggle("active", lpMetro); });

  // Teclas 1-8
  document.addEventListener("keydown", e => {
    const view = document.getElementById("module-sampler");
    if (!view || view.hidden || e.repeat) return;
    const idx = ["1", "2", "3", "4", "5", "6", "7", "8"].indexOf(e.key);
    if (idx >= 0) { e.preventDefault(); smpPlayPad(idx); }
  });
}

// Al cambiar BPM/compases, re-sincroniza los loops que estén sonando
function lpResyncActive() {
  if (!lpPlaying) return;
  lpStartTime = smpAudioCtx.currentTime;
  const next = lpNextLoopStart();
  smpPads.forEach((p, i) => { if (p.active && p.buffer) lpStartLoopSource(i, next); });
}

function samplerInit() {
  initSamplerControls();
  setTimeout(() => smpClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", samplerInit);
