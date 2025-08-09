// Minimal Audio Cropper — vanilla JS + Tailwind UI
(() => {
	const fileInput = document.getElementById('fileInput');
	const playPauseBtn = document.getElementById('playPauseBtn');
	const stopBtn = document.getElementById('stopBtn');
	const clearClipsBtn = document.getElementById('clearClipsBtn');
	const waveCanvas = document.getElementById('waveCanvas');
	const waveWrap = document.getElementById('waveWrap');
	const clipsList = document.getElementById('clipsList');
	const durationLabel = document.getElementById('durationLabel');
  
	const dpr = Math.max(1, window.devicePixelRatio || 1);
	const state = {
	  audioCtx: null,
	  buffer: null,
	  source: null,
	  playing: false,
	  startTime: 0, // when current play started, in audioCtx time
	  playOffset: 0, // where playback started within audio
	  clips: [],     // { id, start, end, color }
	  hover: null,   // { type: 'move'|'left'|'right', clipId } for cursor
	  drag: null,    // current drag op
	};
  
	// Utility: time & px conversions
	const xToTime = (x) => {
	  const rect = waveCanvas.getBoundingClientRect();
	  const w = rect.width;
	  const duration = state.buffer ? state.buffer.duration : 1;
	  return Math.min(Math.max(0, (x / w) * duration), duration);
	};
	const timeToX = (t) => {
	  const rect = waveCanvas.getBoundingClientRect();
	  const w = rect.width;
	  const duration = state.buffer ? state.buffer.duration : 1;
	  return (t / duration) * w;
	};
  
	// Resize canvas properly for DPR
	const resizeCanvas = () => {
	  const rect = waveWrap.getBoundingClientRect();
	  waveCanvas.width = Math.floor(rect.width * dpr);
	  waveCanvas.height = Math.floor(rect.height * dpr);
	  waveCanvas.style.width = `${rect.width}px`;
	  waveCanvas.style.height = `${rect.height}px`;
	  draw();
	};
	window.addEventListener('resize', resizeCanvas);
  
	// Draw waveform + clips
	const draw = () => {
	  const ctx = waveCanvas.getContext('2d');
	  const W = waveCanvas.width, H = waveCanvas.height;
	  ctx.clearRect(0, 0, W, H);
  
	  // Background grid-ish baseline
	  ctx.fillStyle = '#0a0a0a';
	  ctx.fillRect(0, 0, W, H);
  
	  // Draw waveform
	  if (state.buffer) {
		const dataL = state.buffer.getChannelData(0);
		const dataR = state.buffer.numberOfChannels > 1 ? state.buffer.getChannelData(1) : null;
  
		ctx.save();
		ctx.translate(0, H / 2);
		ctx.strokeStyle = '#6b7280'; // neutral-500
		ctx.globalAlpha = 0.9;
		ctx.beginPath();
  
		const samplesPerPx = Math.max(1, Math.floor(state.buffer.length / W));
		for (let x = 0; x < W; x++) {
		  let min = 1, max = -1;
		  const start = x * samplesPerPx;
		  const end = Math.min(start + samplesPerPx, state.buffer.length);
		  for (let i = start; i < end; i++) {
			const vL = dataL[i];
			const vR = dataR ? dataR[i] : vL;
			const v = (vL + vR) * 0.5;
			if (v < min) min = v;
			if (v > max) max = v;
		  }
		  const y1 = Math.floor(min * (H / 2));
		  const y2 = Math.ceil(max * (H / 2));
		  ctx.moveTo(x + 0.5, y1);
		  ctx.lineTo(x + 0.5, y2);
		}
		ctx.stroke();
		ctx.restore();
  
		// Draw clips overlay
		for (const clip of state.clips) {
		  const x1 = Math.floor(timeToX(clip.start) * dpr);
		  const x2 = Math.ceil(timeToX(clip.end) * dpr);
		  const w = Math.max(1, x2 - x1);
  
		  // region fill
		  ctx.fillStyle = clip.color + '33'; // 20% alpha
		  ctx.fillRect(x1, 0, w, H);
  
		  // boundaries
		  ctx.fillStyle = clip.color;
		  ctx.fillRect(x1, 0, 2 * dpr, H);
		  ctx.fillRect(x2 - 2 * dpr, 0, 2 * dpr, H);
  
		  // label tag
		  const label = `Clip ${clip.id}`;
		  ctx.font = `${12 * dpr}px ui-sans-serif, system-ui, -apple-system`;
		  ctx.fillStyle = '#e5e7eb'; // neutral-200
		  const tx = Math.min(x1 + 6 * dpr, W - 60 * dpr);
		  const ty = 16 * dpr;
		  ctx.fillText(label, tx, ty);
		}
  
		// Playhead
		if (state.playing) {
		  const tNow = state.audioCtx.currentTime;
		  const t = state.playOffset + (tNow - state.startTime);
		  const px = Math.floor(timeToX(t) * dpr);
		  ctx.fillStyle = '#f59e0b'; // amber-500
		  ctx.fillRect(px, 0, 2 * dpr, H);
		}
	  }
	};
  
	// Animation loop for playhead
	const rafLoop = () => {
	  if (state.playing) draw();
	  requestAnimationFrame(rafLoop);
	};
	requestAnimationFrame(rafLoop);
  
	// Audio helpers
	const stopPlayback = () => {
	  try { state.source && state.source.stop(0); } catch {}
	  state.source = null;
	  state.playing = false;
	  playPauseBtn.textContent = 'Play';
	  draw();
	};
  
	const playAll = () => {
	  if (!state.buffer || !state.audioCtx) return;
	  stopPlayback();
	  state.source = state.audioCtx.createBufferSource();
	  state.source.buffer = state.buffer;
	  state.source.connect(state.audioCtx.destination);
	  state.playOffset = 0;
	  state.startTime = state.audioCtx.currentTime;
	  state.playing = true;
	  state.source.onended = () => {
		state.playing = false;
		playPauseBtn.textContent = 'Play';
		draw();
	  };
	  state.source.start(0);
	  playPauseBtn.textContent = 'Pause';
	  draw();
	};
  
	const pause = () => {
	  if (!state.playing) return;
	  // compute offset
	  const tNow = state.audioCtx.currentTime;
	  state.playOffset += (tNow - state.startTime);
	  stopPlayback();
	};
  
	const playClip = (clip) => {
	  if (!state.buffer || !state.audioCtx) return;
	  stopPlayback();
	  const duration = Math.max(0, clip.end - clip.start);
	  if (duration <= 0.01) return;
	  state.source = state.audioCtx.createBufferSource();
	  state.source.buffer = state.buffer;
	  state.source.connect(state.audioCtx.destination);
	  state.playOffset = clip.start;
	  state.startTime = state.audioCtx.currentTime;
	  state.playing = true;
	  state.source.onended = () => {
		state.playing = false;
		playPauseBtn.textContent = 'Play';
		draw();
	  };
	  state.source.start(0, clip.start, duration);
	  playPauseBtn.textContent = 'Pause';
	  draw();
	};
  
	// File loading
	fileInput.addEventListener('change', async (e) => {
	  const file = e.target.files?.[0];
	  if (!file) return;
  
	  if (!state.audioCtx) {
		state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
	  }
	  stopPlayback();
	  state.clips = [];
	  clipsList.innerHTML = '';
  
	  const arr = await file.arrayBuffer();
	  const buffer = await state.audioCtx.decodeAudioData(arr);
	  state.buffer = buffer;
	  durationLabel.textContent = `Duration: ${buffer.duration.toFixed(2)}s`;
	  playPauseBtn.disabled = false;
	  stopBtn.disabled = false;
	  clearClipsBtn.disabled = false;
  
	  resizeCanvas();
	});
  
	// Top-level controls
	playPauseBtn.addEventListener('click', () => {
	  if (!state.buffer) return;
	  if (!state.playing) {
		// resume context if needed
		if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
		playAll();
	  } else {
		pause();
	  }
	});
  
	stopBtn.addEventListener('click', () => {
	  pause();
	  state.playOffset = 0;
	  draw();
	});
  
	clearClipsBtn.addEventListener('click', () => {
	  state.clips = [];
	  renderClipsList();
	  draw();
	});
  
	// Generate nice colors for clips
	const palette = ['#60a5fa', '#34d399', '#f472b6', '#f59e0b', '#a78bfa', '#22d3ee', '#fb7185'];
	const nextColor = (i) => palette[i % palette.length];
  
	// Clip list UI
	const renderClipsList = () => {
	  clipsList.innerHTML = '';
	  if (!state.clips.length) {
		const li = document.createElement('li');
		li.className = 'text-sm text-neutral-500';
		li.textContent = 'No clips yet.';
		clipsList.appendChild(li);
		return;
	  }
	  state.clips
		.slice()
		.sort((a, b) => a.start - b.start)
		.forEach((clip) => {
		  const li = document.createElement('li');
		  li.className = 'flex items-center justify-between gap-3 bg-neutral-900 ring-1 ring-neutral-800 rounded-2xl px-3 py-2';
  
		  const left = document.createElement('div');
		  left.className = 'flex items-center gap-2 text-sm';
		  const sw = document.createElement('span');
		  sw.className = 'inline-block w-3 h-3 rounded-full';
		  sw.style.background = clip.color;
		  const label = document.createElement('span');
		  label.textContent = `Clip ${clip.id}`;
		  const times = document.createElement('span');
		  times.className = 'text-neutral-400';
		  times.textContent = `(${clip.start.toFixed(2)}s – ${clip.end.toFixed(2)}s)`;
		  left.append(sw, label, times);
  
		  const right = document.createElement('div');
		  right.className = 'flex items-center gap-2';
		  const playBtn = document.createElement('button');
		  playBtn.className = 'px-2 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs';
		  playBtn.textContent = 'Play';
		  playBtn.addEventListener('click', () => playClip(clip));
  
		  const delBtn = document.createElement('button');
		  delBtn.className = 'px-2 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs';
		  delBtn.textContent = 'Delete';
		  delBtn.addEventListener('click', () => {
			state.clips = state.clips.filter((c) => c.id !== clip.id);
			renderClipsList();
			draw();
		  });
  
		  right.append(playBtn, delBtn);
		  li.append(left, right);
		  clipsList.appendChild(li);
		});
	};
  
	// Region hit-testing for hover and drag logic
	const EDGE_PX = 6;
	const getHoverAt = (clientX) => {
	  if (!state.buffer) return null;
	  const rect = waveCanvas.getBoundingClientRect();
	  const x = clientX - rect.left;
	  const t = xToTime(x);
  
	  // find clip containing t (or near edges)
	  for (const clip of state.clips) {
		const x1 = timeToX(clip.start);
		const x2 = timeToX(clip.end);
		if (Math.abs(x - x1) <= EDGE_PX) return { type: 'left', clipId: clip.id };
		if (Math.abs(x - x2) <= EDGE_PX) return { type: 'right', clipId: clip.id };
		if (x > x1 && x < x2) return { type: 'move', clipId: clip.id };
	  }
	  return null;
	};
  
	const setCursor = (hover) => {
	  if (!hover) {
		waveWrap.style.cursor = 'crosshair';
	  } else if (hover.type === 'move') {
		waveWrap.style.cursor = 'grab';
	  } else {
		waveWrap.style.cursor = 'ew-resize';
	  }
	};
  
	// Pointer events (mouse/touch)
	let isPointerDown = false;
	waveWrap.addEventListener('pointermove', (e) => {
	  if (!state.buffer) return;
	  if (!isPointerDown && !state.drag) {
		state.hover = getHoverAt(e.clientX);
		setCursor(state.hover);
	  }
  
	  if (state.drag) {
		const rect = waveCanvas.getBoundingClientRect();
		const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
		const t = xToTime(x);
  
		if (state.drag.mode === 'create') {
		  state.drag.t2 = t;
		} else if (state.drag.mode === 'move') {
		  const clip = state.clips.find(c => c.id === state.drag.clipId);
		  if (!clip) return;
		  const duration = state.buffer.duration;
		  const width = state.drag.original.end - state.drag.original.start;
		  let newStart = t - state.drag.grabOffset;
		  newStart = Math.max(0, Math.min(newStart, duration - width));
		  clip.start = newStart;
		  clip.end = newStart + width;
		} else if (state.drag.mode === 'resize-left') {
		  const clip = state.clips.find(c => c.id === state.drag.clipId);
		  if (!clip) return;
		  const newStart = Math.min(Math.max(0, t), clip.end - 0.01);
		  clip.start = newStart;
		} else if (state.drag.mode === 'resize-right') {
		  const clip = state.clips.find(c => c.id === state.drag.clipId);
		  if (!clip) return;
		  const newEnd = Math.max(clip.start + 0.01, Math.min(state.buffer.duration, t));
		  clip.end = newEnd;
		}
		draw();
		renderClipsList();
	  }
	});
  
	waveWrap.addEventListener('pointerdown', (e) => {
	  if (!state.buffer) return;
	  waveWrap.setPointerCapture(e.pointerId);
	  isPointerDown = true;
  
	  const hover = getHoverAt(e.clientX);
	  if (hover) {
		// begin drag on existing clip
		const clip = state.clips.find(c => c.id === hover.clipId);
		const rect = waveCanvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const t = xToTime(x);
		if (hover.type === 'move') {
		  state.drag = {
			mode: 'move',
			clipId: clip.id,
			original: { start: clip.start, end: clip.end },
			grabOffset: t - clip.start,
		  };
		} else if (hover.type === 'left') {
		  state.drag = { mode: 'resize-left', clipId: clip.id };
		} else if (hover.type === 'right') {
		  state.drag = { mode: 'resize-right', clipId: clip.id };
		}
		setCursor({ type: 'move' });
	  } else {
		// begin creating a new region
		const rect = waveCanvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const t = xToTime(x);
		state.drag = { mode: 'create', t1: t, t2: t };
		setCursor(null);
	  }
	});
  
	const finishCreate = () => {
	  if (!state.drag || state.drag.mode !== 'create') return;
	  const t1 = Math.min(state.drag.t1, state.drag.t2);
	  const t2 = Math.max(state.drag.t1, state.drag.t2);
	  if (t2 - t1 >= 0.05) {
		const id = (state.clips.reduce((m, c) => Math.max(m, c.id), 0) + 1) || 1;
		const idx = state.clips.length;
		state.clips.push({
		  id,
		  start: t1,
		  end: t2,
		  color: nextColor(idx),
		});
		renderClipsList();
	  }
	};
  
	waveWrap.addEventListener('pointerup', (e) => {
	  if (!state.buffer) return;
	  isPointerDown = false;
	  waveWrap.releasePointerCapture(e.pointerId);
  
	  if (state.drag) {
		if (state.drag.mode === 'create') finishCreate();
		state.drag = null;
		state.hover = null;
		setCursor(null);
		draw();
	  }
	});
  
	// Visualize in-progress creation drag as a transient region
	const drawOverlayDuringCreate = () => {
	  if (!state.drag || state.drag.mode !== 'create' || !state.buffer) {
		requestAnimationFrame(drawOverlayDuringCreate);
		return;
	  }
	  draw();
	  const ctx = waveCanvas.getContext('2d');
	  const W = waveCanvas.width, H = waveCanvas.height;
  
	  const x1 = Math.floor(timeToX(Math.min(state.drag.t1, state.drag.t2)) * dpr);
	  const x2 = Math.ceil(timeToX(Math.max(state.drag.t1, state.drag.t2)) * dpr);
  
	  ctx.fillStyle = '#60a5fa33';
	  ctx.fillRect(x1, 0, Math.max(1, x2 - x1), H);
	  ctx.fillStyle = '#60a5fa';
	  ctx.fillRect(x1, 0, 2 * dpr, H);
	  ctx.fillRect(x2 - 2 * dpr, 0, 2 * dpr, H);
  
	  requestAnimationFrame(drawOverlayDuringCreate);
	};
	requestAnimationFrame(drawOverlayDuringCreate);
  
	// Init
	resizeCanvas();
	renderClipsList();
  })();
  