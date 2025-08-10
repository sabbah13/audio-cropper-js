// Minimal Audio Cropper — vanilla JS + Tailwind UI
(() => {
	const fileInput = document.getElementById('fileInput');
	const playPauseBtn = document.getElementById('playPauseBtn');
	const stopBtn = document.getElementById('stopBtn');
	const clearClipsBtn = document.getElementById('clearClipsBtn');
	const downloadAllBtn = document.getElementById('downloadAllBtn');
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
	  activeClipId: null, // null → whole file, number → playing that clip
	  playSessionId: 0, // increments each time we start playback to ignore stale events
	  originalFile: null, // currently loaded File
	  inputFormat: { channels: null, sampleRate: null, bitrateKbps: null },
	  isEmbed: (window.top !== window.self),
	  embedHost: document.referrer || '',
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
  // Re-render list on resize so responsive colon markers update
  window.addEventListener('resize', () => { try { renderClipsList(); } catch {} });
  
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
			const label = `Clip ${String((() => { try { return getClipNumber(clip); } catch { return clip.id; } })()).padStart(2, '0')} (${(clip.end - clip.start).toFixed(2)}s)`;
		  ctx.font = `${12 * dpr}px ui-sans-serif, system-ui, -apple-system`;
		  ctx.fillStyle = '#e5e7eb'; // neutral-200
		  const tx = Math.min(x1 + 6 * dpr, W - 60 * dpr);
		  const ty = 16 * dpr;
		  ctx.fillText(label, tx, ty);
		}
  
		// Playhead (always visible when buffer is loaded)
		const tNow = state.audioCtx ? state.audioCtx.currentTime : 0;
		let t = state.playOffset + (state.playing ? (tNow - state.startTime) : 0);
		t = Math.max(0, Math.min(t, state.buffer.duration));
		const px = Math.floor(timeToX(t) * dpr);
		ctx.fillStyle = '#f59e0b'; // amber-500
		ctx.fillRect(px, 0, 2 * dpr, H);
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
	  // Invalidate current session so onended from previous source is ignored
	  state.playSessionId++;
	  try {
		if (state.source) {
		  try { state.source.onended = null; } catch {}
		  state.source.stop(0);
		}
	  } catch {}
	  state.source = null;
	  state.playing = false;
	  updateTransportUI();
	  draw();
	};

	const updateTransportUI = () => {
	  playPauseBtn.textContent = state.playing ? 'Pause' : 'Play';
	  // Update clip buttons to reflect active/playing status
	  // Re-render list for simplicity so buttons reflect current state
	  renderClipsList();
	};
  
	const playAll = (offsetOverride = null) => {
	  if (!state.buffer || !state.audioCtx) return;
	  stopPlayback();
	  const clamp = (t) => Math.max(0, Math.min(t || 0, state.buffer.duration));
	  let offset = offsetOverride != null ? clamp(offsetOverride) : clamp(state.playOffset);
	  if (offsetOverride == null) {
		// If offset is at (or extremely near) end, restart from 0 to ensure we hear playback
		if (offset >= state.buffer.duration - 0.005) offset = 0;
	  }
	  state.source = state.audioCtx.createBufferSource();
	  state.source.buffer = state.buffer;
	  state.source.connect(state.audioCtx.destination);
	  state.startTime = state.audioCtx.currentTime;
	  state.playing = true;
	  state.activeClipId = null;
	  const sessionId = ++state.playSessionId;
	  state.source.onended = () => {
		if (sessionId !== state.playSessionId) return; // stale
		state.playing = false;
		state.playOffset = state.buffer.duration;
		updateTransportUI();
		draw();
	  };
	  // Play from current offset to end
	  state.source.start(0, offset);
	  updateTransportUI();
	  draw();
	};

	const seekAndPlayAt = async (timeSec) => {
	  if (!state.buffer || !state.audioCtx) return;
	  if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();
	  const t = Math.max(0, Math.min(timeSec, state.buffer.duration));
	  state.playOffset = t;
	  state.activeClipId = null;
	  playAll(t);
	};
  
	const pause = () => {
	  if (!state.playing) return;
	  // compute offset
	  const tNow = state.audioCtx.currentTime;
	  state.playOffset += (tNow - state.startTime);
	  stopPlayback();
	  updateTransportUI();
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
	  state.activeClipId = clip.id;
	  const sessionId = ++state.playSessionId;
	  state.source.onended = () => {
		if (sessionId !== state.playSessionId) return; // stale
		state.playing = false;
		state.playOffset = clip.end;
		updateTransportUI();
		draw();
	  };
	  state.source.start(0, clip.start, duration);
	  updateTransportUI();
	  draw();
	};

	const resumeClip = (clip) => {
	  if (!state.buffer || !state.audioCtx) return;
	  stopPlayback();
	  let offset = state.playOffset;
	  // Ensure offset lies within the clip bounds
	  if (offset < clip.start || offset >= clip.end - 0.005) {
		offset = clip.start;
	  }
	  const remaining = Math.max(0, clip.end - offset);
	  if (remaining <= 0.01) return;
	  state.source = state.audioCtx.createBufferSource();
	  state.source.buffer = state.buffer;
	  state.source.connect(state.audioCtx.destination);
	  state.playOffset = offset;
	  state.startTime = state.audioCtx.currentTime;
	  state.playing = true;
	  state.activeClipId = clip.id;
	  const sessionId = ++state.playSessionId;
	  state.source.onended = () => {
		if (sessionId !== state.playSessionId) return;
		state.playing = false;
		state.playOffset = clip.end;
		updateTransportUI();
		draw();
	  };
	  state.source.start(0, offset, remaining);
	  updateTransportUI();
	  draw();
	};

	const stopAll = () => {
	  stopPlayback();
	  state.playOffset = 0; // Always reset to beginning of full file
	  state.activeClipId = null;
	  updateTransportUI();
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
	  state.playOffset = 0;
	  state.activeClipId = null;
	  state.originalFile = file;
	  state.inputFormat = { channels: null, sampleRate: null, bitrateKbps: null };
  
	  const arr = await file.arrayBuffer();
	  const buffer = await state.audioCtx.decodeAudioData(arr);
	  state.buffer = buffer;
	  durationLabel.textContent = `Duration: ${buffer.duration.toFixed(2)}s`;
	  playPauseBtn.disabled = false;
	  stopBtn.disabled = false;
	  clearClipsBtn.disabled = false;
	  downloadAllBtn.disabled = true;
  
	  resizeCanvas();
  // Populate format from decoded buffer only (avoid loading external parsers in embeds)
  state.inputFormat = {
    channels: Math.min(2, buffer.numberOfChannels || 2),
    sampleRate: buffer.sampleRate,
    bitrateKbps: null,
  };
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
	  stopAll();
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
		downloadAllBtn.disabled = true;
		return;
	  }
	  downloadAllBtn.disabled = false;
	  state.clips
		.slice()
		.sort((a, b) => a.start - b.start)
		.forEach((clip, idx) => {
		  const li = document.createElement('li');
		  li.className = 'flex items-center justify-between gap-3 bg-neutral-900 ring-1 ring-neutral-800 rounded-2xl px-3 py-2';
  
		  const left = document.createElement('div');
		  left.className = 'flex items-center gap-2 text-sm';
		  const sw = document.createElement('span');
		  sw.className = 'inline-block w-3 h-3 rounded-full';
		  sw.style.background = clip.color;
		  const label = document.createElement('span');
		  label.textContent = `Clip ${String(idx + 1).padStart(2, '0')}`;
      const times = document.createElement('span');
      times.className = 'text-neutral-400';
      const dur = Math.max(0, clip.end - clip.start);
      const uiStart = secondsToUI(clip.start);
      const uiEnd = secondsToUI(clip.end);
      const markers = makeColonMarkers(dur);
      times.textContent = `(${uiStart} – ${uiEnd}) ${markers} ${dur.toFixed(2)}s`;
		  left.append(sw, label, times);
  
		  const right = document.createElement('div');
		  right.className = 'flex items-center gap-2';
	  const playBtn = document.createElement('button');
		  playBtn.className = 'px-2 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs';
	  playBtn.textContent = (state.activeClipId === clip.id && state.playing) ? 'Pause' : 'Play';
	  playBtn.addEventListener('click', async () => {
			if (!state.buffer) return;
		if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();
		if (state.activeClipId === clip.id) {
		  if (state.playing) {
			pause();
		  } else {
			resumeClip(clip);
		  }
		} else {
		  playClip(clip);
		}
		  });

		  const dlBtn = document.createElement('button');
		  dlBtn.className = 'px-2 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs';
		  dlBtn.textContent = 'Download';
		  dlBtn.addEventListener('click', async () => {
			try {
			  dlBtn.disabled = true;
			  dlBtn.textContent = 'Preparing…';
			  const blob = await exportClipToMp3(clip);
			  const fname = makeClipFilename(clip);
			  downloadBlob(blob, fname);
			} catch (err) {
			  console.error('Download failed', err);
			} finally {
			  dlBtn.disabled = false;
			  dlBtn.textContent = 'Download';
			}
		  });
  
		  const delBtn = document.createElement('button');
		  delBtn.className = 'px-2 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs';
		  delBtn.textContent = 'Delete';
		  delBtn.addEventListener('click', () => {
			state.clips = state.clips.filter((c) => c.id !== clip.id);
			renderClipsList();
			draw();
		  });
  
		  right.append(playBtn, dlBtn, delBtn);
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
		} else if (state.drag.mode === 'maybe-create') {
		  state.drag.t2 = t;
		  // Promote to create if movement exceeds threshold
		  if (Math.abs(state.drag.t2 - state.drag.t1) >= 0.02) state.drag.mode = 'create';
		} else if (state.drag.mode === 'maybe-move') {
		  state.drag.t2 = t;
		  if (Math.abs(state.drag.t2 - state.drag.t1) >= 0.02) {
			// Promote to real move
			const clip = state.clips.find(c => c.id === state.drag.clipId);
			if (clip) {
			  state.drag = {
				mode: 'move',
				clipId: clip.id,
				original: { start: clip.start, end: clip.end },
				grabOffset: state.drag.grabOffset,
			  };
			}
		  }
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
		// Potential drag inside existing clip; defer until movement threshold is exceeded
		const clip = state.clips.find(c => c.id === hover.clipId);
		const rect = waveCanvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const t = xToTime(x);
		if (hover.type === 'move') {
		  state.drag = { mode: 'maybe-move', clipId: clip.id, t1: t, t2: t, grabOffset: t - clip.start };
		} else if (hover.type === 'left') {
		  state.drag = { mode: 'resize-left', clipId: clip.id };
		} else if (hover.type === 'right') {
		  state.drag = { mode: 'resize-right', clipId: clip.id };
		}
		setCursor({ type: 'move' });
	  } else {
		// If user clicks without dragging → seek. We'll detect click vs drag on pointerup.
		const rect = waveCanvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const t = xToTime(x);
		state.drag = { mode: 'maybe-create', t1: t, t2: t, moved: false };
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
  
	waveWrap.addEventListener('pointerup', async (e) => {
	  if (!state.buffer) return;
	  isPointerDown = false;
	  waveWrap.releasePointerCapture(e.pointerId);
  
	  if (state.drag) {
		if (state.drag.mode === 'create') finishCreate();
		else if (state.drag.mode === 'maybe-create') {
		  // Treat as seek if minimal movement
		  const t1 = Math.min(state.drag.t1, state.drag.t2);
		  const t2 = Math.max(state.drag.t1, state.drag.t2);
		  if (Math.abs(t2 - t1) < 0.02) {
			// simple click → seek + start playback
			await seekAndPlayAt(t1);
		  } else {
			finishCreate();
		  }
		} else if (state.drag.mode === 'maybe-move') {
		  // Simple click inside clip → seek + start playback
		  const t1 = Math.min(state.drag.t1, state.drag.t2);
		  await seekAndPlayAt(t1);
		}
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

	// ----------------------
	// Export helpers (MP3 + ZIP)
	// ----------------------
    const loadExternalScript = (url) => new Promise((resolve, reject) => {
	  if (document.querySelector(`script[src="${url}"]`)) return resolve();
	  const s = document.createElement('script');
	  s.src = url;
	  s.onload = () => resolve();
	  s.onerror = (e) => reject(e);
	  document.head.appendChild(s);
	});

    const ensureLame = async () => {
      if (window.lamejs) return;
      try { await loadExternalScript('./vendor/lame.min.js'); return; } catch {}
      await loadExternalScript('https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js');
    };

	const ensureMusicMetadata = async () => {
	  // Skip in restricted iframes (e.g., Notion) to avoid noisy console errors
	  if (state.isEmbed && /notion\.so/.test(state.embedHost)) return;
	  if (window.musicMetadata && typeof window.musicMetadata.parseBlob === 'function') return;
	  try { await loadExternalScript('./vendor/music-metadata-browser.min.js'); return; } catch {}
	  await loadExternalScript('https://cdn.jsdelivr.net/npm/music-metadata-browser@2.5.10/dist/music-metadata-browser.min.js');
	};

    const ensureJSZip = async () => {
      if (window.JSZip) return;
      try { await loadExternalScript('./vendor/jszip.min.js'); return; } catch {}
      await loadExternalScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
    };

	const floatTo16BitPCM = (input) => {
	  const output = new Int16Array(input.length);
	  for (let i = 0; i < input.length; i++) {
		let s = Math.max(-1, Math.min(1, input[i]));
		output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	  }
	  return output;
	};

	const slicePcm = (buffer, startSec, endSec, channelsWanted) => {
	  const sr = buffer.sampleRate;
	  const startFrame = Math.floor(startSec * sr);
	  const endFrame = Math.floor(endSec * sr);
	  const frames = Math.max(0, endFrame - startFrame);
	  const numCh = buffer.numberOfChannels;
	  const getCh = (i) => buffer.getChannelData(Math.min(i, numCh - 1));
	  if (channelsWanted === 1) {
		const mono = new Float32Array(frames);
		for (let i = 0; i < frames; i++) {
		  let sum = 0;
		  for (let ch = 0; ch < numCh; ch++) sum += getCh(ch)[startFrame + i] || 0;
		  mono[i] = sum / Math.max(1, numCh);
		}
		return { sampleRate: sr, channels: 1, mono };
	  } else {
		const left = new Float32Array(frames);
		const right = new Float32Array(frames);
		const srcL = getCh(0);
		const srcR = numCh > 1 ? getCh(1) : null;
		for (let i = 0; i < frames; i++) {
		  left[i] = srcL[startFrame + i] || 0;
		  right[i] = srcR ? (srcR[startFrame + i] || 0) : left[i];
		}
		return { sampleRate: sr, channels: 2, left, right };
	  }
	};

	const encodeMp3 = async ({ channels, sampleRate, pcm }) => {
	  await ensureLame();
	  const Mp3Encoder = window.lamejs.Mp3Encoder;
	  const targetBitrate = (state.inputFormat && state.inputFormat.bitrateKbps) ? state.inputFormat.bitrateKbps : 320;
	  const bitrate = Math.max(64, Math.min(320, targetBitrate));
	  const supportedRates = [32000, 44100, 48000];
	  const sr = supportedRates.reduce((prev, curr) => Math.abs(curr - sampleRate) < Math.abs(prev - sampleRate) ? curr : prev, supportedRates[0]);
	  const encoder = new Mp3Encoder(channels, sr, bitrate);
	  const blockSize = 1152;
	  let mp3Data = [];
	  if (channels === 1) {
		const mono16 = floatTo16BitPCM(pcm.mono);
		for (let i = 0; i < mono16.length; i += blockSize) {
		  const chunk = mono16.subarray(i, i + blockSize);
		  const enc = encoder.encodeBuffer(chunk);
		  if (enc.length > 0) mp3Data.push(enc);
		}
	  } else {
		const left16 = floatTo16BitPCM(pcm.left);
		const right16 = floatTo16BitPCM(pcm.right);
		for (let i = 0; i < left16.length; i += blockSize) {
		  const l = left16.subarray(i, i + blockSize);
		  const r = right16.subarray(i, i + blockSize);
		  const enc = encoder.encodeBuffer(l, r);
		  if (enc.length > 0) mp3Data.push(enc);
		}
	  }
	  const end = encoder.flush();
	  if (end.length > 0) mp3Data.push(end);
	  return new Blob(mp3Data, { type: 'audio/mpeg' });
	};

	const exportClipToMp3 = async (clip) => {
	  if (!state.buffer) throw new Error('No buffer');
	  const wantedChannels = (state.inputFormat && typeof state.inputFormat.channels === 'number')
		? Math.max(1, Math.min(2, state.inputFormat.channels))
		: Math.min(2, state.buffer.numberOfChannels || 2);
	  const pcmSlice = slicePcm(state.buffer, clip.start, clip.end, wantedChannels);
	  const sampleRate = (state.inputFormat && state.inputFormat.sampleRate) ? state.inputFormat.sampleRate : pcmSlice.sampleRate;
	  if (pcmSlice.channels === 1) {
		return encodeMp3({ channels: 1, sampleRate, pcm: { mono: pcmSlice.mono } });
	  }
	  return encodeMp3({ channels: 2, sampleRate, pcm: { left: pcmSlice.left, right: pcmSlice.right } });
	};

	// Filename helpers
	const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

	const secondsToHMS = (seconds) => {
	  const total = Math.max(0, Math.floor(seconds || 0));
	  let hours = Math.floor(total / 3600);
	  const minutes = Math.floor((total % 3600) / 60);
	  const secs = total % 60;
	  if (hours > 99) hours = 99;
	  return `${pad2(hours)}.${pad2(minutes)}.${pad2(secs)}`;
	};

  // For filenames: HH.MM.SS.mmm (milliseconds)
  const secondsToHMSms = (seconds) => {
    const totalMs = Math.max(0, Math.round((seconds || 0) * 1000));
    let totalSec = Math.floor(totalMs / 1000);
    const ms = totalMs % 1000;
    let hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hours > 99) hours = 99;
    return `${pad2(hours)}.${pad2(minutes)}.${pad2(secs)}.${String(ms).padStart(3, '0')}`;
  };

	const sanitizeBaseName = (name) => {
	  let safe = String(name || '')
		.replace(/[\\/:*?"<>|]/g, '_')
		.replace(/\s+/g, ' ');
	  safe = safe.replace(/^[ .]+|[ .]+$/g, '');
	  return safe || 'audio';
	};

	const getOriginalBaseName = () => {
	  const file = state.originalFile;
	  if (!file || !file.name) return 'audio';
	  const name = file.name;
	  const idx = name.lastIndexOf('.');
	  const base = idx > 0 ? name.slice(0, idx) : name;
	  return sanitizeBaseName(base);
	};

	const compareClips = (a, b) => {
	  if (a.start !== b.start) return a.start - b.start;
	  if (a.end !== b.end) return a.end - b.end;
	  const aid = (a && typeof a.id === 'number') ? a.id : 0;
	  const bid = (b && typeof b.id === 'number') ? b.id : 0;
	  return aid - bid;
	};

	const getOrderedClips = () => (state.clips || []).slice().sort(compareClips);

	const getClipNumber = (clip) => {
	  const ordered = getOrderedClips();
	  const idx = ordered.findIndex((c) => c === clip || (typeof c.id !== 'undefined' && c.id === clip.id));
	  return idx >= 0 ? idx + 1 : 1;
	};

	const makeClipFilename = (clip) => {
	  const base = getOriginalBaseName();
    const nn = pad2(getClipNumber(clip));
    const start = secondsToHMSms(clip && typeof clip.start === 'number' ? clip.start : 0);
    const end = secondsToHMSms(clip && typeof clip.end === 'number' ? clip.end : 0);
    const duration = Math.max(0, (clip && typeof clip.start === 'number' && typeof clip.end === 'number') ? (clip.end - clip.start) : 0);
    const durStr = duration.toFixed(2);
    return `${base}---clip-${nn}-${start}-${end}-${durStr}.mp3`;
	};

  // UI time formatter: HH:MM:SS:CC (centiseconds)
  const secondsToUI = (seconds) => {
    const t = Math.max(0, Number(seconds) || 0);
    const whole = Math.floor(t);
    let hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    if (hours > 99) hours = 99;
    const centi = Math.floor((t - whole) * 100);
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}:${pad2(centi)}`;
  };

  // Visual duration markers: one ':' per 15s, max 10. On small screens show 1.
  const makeColonMarkers = (durationSec) => {
    const full = Math.min(10, Math.floor(Math.max(0, durationSec) / 15));
    const isWide = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(min-width: 768px)').matches;
    const count = isWide ? Math.max(1, full) : 1;
    return new Array(count).fill(':').join(' ');
  };

	const downloadBlob = (blob, filename) => {
	  const url = URL.createObjectURL(blob);
	  try {
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.rel = 'noopener';
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 4000);
		return;
	  } catch (err) {
		console.warn('Direct download failed, trying to open in new tab', err);
	  }
	  // Fallbacks for sandboxed embeds (e.g., Notion)
	  const win = window.open(url, '_blank', 'noopener');
	  if (!win) {
		showDownloadNotice();
	  }
	  setTimeout(() => URL.revokeObjectURL(url), 8000);
	};

	const showDownloadNotice = () => {
	  let el = document.getElementById('download-blocked');
	  if (!el) {
		el = document.createElement('div');
		el.id = 'download-blocked';
		el.style.position = 'fixed';
		el.style.bottom = '16px';
		el.style.left = '50%';
		el.style.transform = 'translateX(-50%)';
		el.style.background = '#111827';
		el.style.color = '#e5e7eb';
		el.style.padding = '10px 14px';
		el.style.borderRadius = '12px';
		el.style.boxShadow = '0 10px 25px rgba(0,0,0,0.35)';
		el.style.zIndex = '9999';
		el.style.fontSize = '12px';
		el.innerHTML = "Downloads are blocked in this embed. <a href='.' target='_blank' rel='noopener' style='color:#93c5fd;text-decoration:underline'>Open in new tab</a> and try again.";
		document.body.appendChild(el);
		setTimeout(() => { try { el.remove(); } catch {} }, 8000);
	  }
	};

	downloadAllBtn.addEventListener('click', async () => {
	  if (!state.clips.length) return;
	  try {
		downloadAllBtn.disabled = true;
		downloadAllBtn.textContent = 'Preparing…';
		await ensureJSZip();
		const zip = new window.JSZip();
		for (const clip of state.clips) {
		  const blob = await exportClipToMp3(clip);
		  const fname = makeClipFilename(clip);
		  zip.file(fname, blob);
		}
		const content = await zip.generateAsync({ type: 'blob' });
		const archiveBase = getOriginalBaseName();
		downloadBlob(content, `${archiveBase}---clips.zip`);
	  } catch (err) {
		console.error('Download all failed', err);
	  } finally {
		downloadAllBtn.textContent = 'Download All';
		downloadAllBtn.disabled = state.clips.length === 0;
	  }
	});
  })();
  