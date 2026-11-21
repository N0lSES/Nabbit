// Compressor: the rules for each kind of file (which ffmpeg / Ghostscript arguments, what the result
// is called, roughly how big it will be). Loaded by Node (main.js, tests) and by the window
// (<script src="../compressor.js">), so no require() here.
//
// Settings, one set per kind of file (the screen edits them; every file of that kind uses them):
//   video  { mode: 'quality'|'size', q: 0–100, targetMB, codec: 'h264'|'h265'|'av1', height: null|1080|720|480,
//            audio: 'keep'|'128'|'96'|'mute', hw: 'cpu'|'nvenc'|'amf' }
//   image  { q: 0–100, format: 'keep'|'jpeg'|'webp'|'avif', maxSide: null|2560|1920|1280 }
//   audio  { kbps: 64–320, format: 'mp3'|'aac'|'opus'|'keep', mono: bool }
//   gif    { colors: 64–256, fps: null|10|15|24, toMp4: bool }
//   pdf    { preset: 'screen'|'ebook'|'printer' }
// Fun mode (video mode 'fun'; image / audio mode 'fun'): deliberately crushed, for laughs.
//   fun    { crush: 0–100 (compression amount), res: 1–100 (% of the original size), audio: 0–100 (audio quality) }
(function (root) {
  const KINDS = {
    video: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'wmv', 'flv', 'ts', 'mts', 'm2ts', 'mpg', 'mpeg', '3gp', 'ogv'],
    audio: ['wav', 'flac', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'ape', 'm4b'],
    image: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff'],
    gif: ['gif'],
    pdf: ['pdf'],
  };
  const extOf = (p) => (String(p).match(/\.([^.\\/]+)$/) || [])[1]?.toLowerCase() || '';
  function kindOf(p) {
    const e = extOf(p);
    return Object.keys(KINDS).find((k) => KINDS[k].includes(e)) || null;
  }

  const DEFAULTS = {
    video: { mode: 'size', q: 62, targetMB: 10, codec: 'h265', height: null, audio: '128', hw: 'cpu', effort: 'balanced', fun: { crush: 75, res: 25, audio: 20 } },
    image: { mode: 'normal', q: 75, format: 'keep', maxSide: 2560, fun: { crush: 75, res: 25 } },
    audio: { mode: 'normal', kbps: 128, format: 'mp3', mono: false, fun: { crush: 75, audio: 20 } },
    gif: { colors: 128, fps: 15, toMp4: true },
    pdf: { preset: 'ebook' },
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------- Fun mode ----------
  const isFun = (s) => s && s.mode === 'fun';
  const funOf = (kind, s) => ({ ...DEFAULTS[kind].fun, ...(s && s.fun) });
  // Resolution slider → the share of the original width / height (1–100 %), and the size it makes.
  const funScale = (res) => clamp(Math.round(res), 1, 100) / 100;
  function funSize(w, h, res) {
    const f = funScale(res), even = (v) => Math.max(16, Math.round((v * f) / 2) * 2);
    return w && h ? [even(w), even(h)] : null;
  }
  const funScaleFilter = (res) => {
    const f = funScale(res);
    if (f >= 1) return null;
    // Nearest-neighbour when small, for crunchy edges; never below 16 px.
    return `scale='max(16,trunc(iw*${f}/2)*2)':'max(16,trunc(ih*${f}/2)*2)':flags=${f <= 0.5 ? 'neighbor' : 'bilinear'}`;
  };
  // Audio slider → bitrate, sample rate, channels, and a bit-crusher below 40.
  function funAudio(q) {
    const a = clamp(q, 0, 100) / 100;
    return {
      kbps: Math.round(8 + 120 * a * a),
      rate: a < 0.15 ? 8000 : a < 0.35 ? 11025 : a < 0.6 ? 22050 : 44100,
      mono: a < 0.35,
      bits: a < 0.4 ? Math.round(4 + (a / 0.4) * 8) : null,
    };
  }
  const funAudioFilter = (fa) => [`aresample=${fa.rate}`, ...(fa.bits ? [`acrusher=bits=${fa.bits}:mode=lin:aa=0`] : [])].join(',');
  // Compression slider → x264 CRF 23…51 and a bitrate ceiling 2000…8 kbit/s.
  const funCrf = (crush) => Math.round(23 + (clamp(crush, 0, 100) / 100) * 28);
  const funMaxrate = (crush) => Math.round(8 + 2000 * (1 - clamp(crush, 0, 100) / 100) ** 2);
  // Compression slider → JPEG quantiser 4…69 (69 is as bad as ffmpeg's JPEG encoder goes).
  const funJpegQ = (crush) => Math.round(4 + (clamp(crush, 0, 100) / 100) * 65);
  function funVideoArgs(input, out, s, info) {
    const f = funOf('video', s), fa = funAudio(f.audio);
    const vf = funScaleFilter(f.res);
    const max = funMaxrate(f.crush);
    const audio = info.hasAudio ? ['-map', '0:a:0', '-af', funAudioFilter(fa), '-ar', String(fa.rate), ...(fa.mono ? ['-ac', '1'] : []), '-c:a', 'aac', '-b:a', `${fa.kbps}k`] : ['-an'];
    return ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:v:0', '-vf', `${vf ? `${vf},` : ''}scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', String(funCrf(f.crush)), '-maxrate', `${max}k`, '-bufsize', `${max * 2}k`,
      ...audio, '-map_metadata', '0', '-movflags', '+faststart', out];
  }

  // ---------- Video ----------
  // Quality slider → CRF (lower = better): x264 34…18, x265 +5, AV1 (SVT) 52…28.
  const crfFor = (codec, q) => {
    const h264 = Math.round(34 - clamp(q, 0, 100) * 0.16);
    return codec === 'h265' ? h264 + 5 : codec === 'av1' ? Math.round(52 - clamp(q, 0, 100) * 0.24) : h264;
  };
  // Encoder names, in the order to try: the chosen hardware one, then the CPU ones.
  const ENCODERS = {
    h264: { cpu: ['libx264'], nvenc: ['h264_nvenc'], amf: ['h264_amf'] },
    h265: { cpu: ['libx265'], nvenc: ['hevc_nvenc'], amf: ['hevc_amf'] },
    av1: { cpu: ['libsvtav1', 'libaom-av1'], nvenc: ['av1_nvenc'], amf: ['av1_amf'] },
  };
  function pickEncoder(codec, hw, has) {
    const list = [...(hw !== 'cpu' ? ENCODERS[codec][hw] || [] : []), ...ENCODERS[codec].cpu];
    return list.find((e) => has(e)) || null;
  }
  // Size mode: the video bitrate (kbit/s) that lands the file just under targetMB (MB = 1,000,000 bytes,
  // as Discord and most upload limits count; 4% kept for the container).
  function sizeBitrate(targetMB, duration, audioKbps) {
    const totalK = (targetMB * 8000 * 0.96) / Math.max(1, duration);
    return Math.floor(totalK - audioKbps);
  }
  const audioKbpsFor = (s) => (s.audio === 'mute' ? 0 : s.audio === '96' ? 96 : 128);
  // Effort: slower presets find more ways to save bits (same size, better picture).
  const EFFORT = {
    fast: { x: 'veryfast', svt: 10, aom: 8, nv: 'p4' },
    balanced: { x: 'slow', svt: 6, aom: 5, nv: 'p7' },
    best: { x: 'slower', svt: 4, aom: 3, nv: 'p7' },
  };
  const effortOf = (s) => EFFORT[s.effort] || EFFORT.balanced;
  // The fewest bits per pixel per frame each codec needs before the picture falls apart; below it a smaller
  // picture looks better than a blocky big one (H.265 ≈ 0.7× H.264, AV1 ≈ 0.5×).
  const MIN_BPP = { h264: 0.03, h265: 0.02, av1: 0.015 };
  const LADDER = [2160, 1440, 1080, 900, 720, 540, 480, 360, 240];
  const bppAt = (kbps, w, h, fps) => (kbps * 1000) / Math.max(1, w * h * fps);
  /**
   * Size mode, strict: the budget for video and audio, then the picture that budget can carry: frame rate
   * capped at 30 when bits are short, the biggest height (never above the source or the chosen one) with
   * enough bits per pixel, and light denoising when it's still tight (noise eats bits). Throws when the
   * video is too long for the size.
   * src: { height, width, fps } → { kbps, audioK, height, fps, denoise }
   */
  function sizePlan(s, duration, src = {}, hasAudio = true) {
    if (typeof src === 'number') src = { height: src };
    const totalK = (s.targetMB * 8000 * 0.96) / Math.max(1, duration);
    let audioK = hasAudio ? audioKbpsFor(s) : 0;
    if (audioK && totalK < 600) audioK = Math.min(audioK, 64);
    if (audioK && totalK < 200) audioK = 32;
    const kbps = Math.floor(totalK - audioK);
    if (kbps < 24) {
      const maxMin = (s.targetMB * 8000 * 0.96) / (24 + audioK) / 60;
      throw new Error(`Too long to fit in ${s.targetMB} MB: ${Math.round(duration / 60)} min of video needs about ${Math.ceil((duration * (24 + audioK)) / 8000 / 0.96)} MB at the lowest usable quality (up to ~${Math.floor(maxMin)} min fits). Trim it first or pick a bigger size.`);
    }
    const srcH = src.height || 1080, srcW = src.width || Math.round((srcH * 16) / 9);
    const need = MIN_BPP[s.codec] || MIN_BPP.h264;
    let fps = src.fps || 30;
    if (fps > 31 && bppAt(kbps, srcW, srcH, fps) < need * 2) fps = 30;
    const cap = Math.min(srcH, s.height || Infinity);
    let h = cap;
    for (const step of [cap, ...LADDER.filter((x) => x < cap)]) {
      h = step;
      if (bppAt(kbps, (srcW * step) / srcH, step, fps) >= need) break;
    }
    const bpp = bppAt(kbps, (srcW * h) / srcH, h, fps);
    // Heights worth a trial encode (main.js measures them and keeps the best): two steps above the guess and
    // one below; none when bits are plentiful at the biggest allowed height.
    const steps = [cap, ...LADDER.filter((x) => x < cap)];
    const at = steps.indexOf(h);
    const trial = bppAt(kbps, (srcW * cap) / srcH, cap, fps) >= need * 2 ? [] : steps.slice(Math.max(0, at - 2), at + 2);
    return { kbps, audioK, height: h < srcH ? h : null, fps: fps < (src.fps || 30) ? fps : null, denoise: bpp < need * 0.5, trial: trial.length > 1 ? trial : [], srcH };
  }
  // How much more an x264 trial gets than the real encoder needs for the same picture.
  const CODEC_GAIN = { h264: 1, h265: 1.45, av1: 1.8 };
  // Rate control → encoder arguments. kbps: a size target (else constant quality); x265: extra x265 params (passes).
  function encoderArgs(enc, s, kbps, x265 = '') {
    const q = crfFor(s.codec, s.q);
    const e = effortOf(s);
    switch (enc) {
      // aq-mode 3 moves bits into dark and flat areas, where low bitrates show banding and blocks first.
      case 'libx264': return ['-c:v', 'libx264', '-preset', e.x, '-pix_fmt', 'yuv420p', '-x264-params', 'aq-mode=3:aq-strength=0.8',
        ...(kbps ? ['-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 3}k`] : ['-crf', String(q)])];
      // 10-bit: fewer bits for the same picture and no banding in skies and gradients (plays wherever H.265 does).
      case 'libx265': return ['-c:v', 'libx265', '-preset', e.x, '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p10le', '-profile:v', 'main10',
        '-x265-params', ['log-level=error', 'aq-mode=3', x265].filter(Boolean).join(':'), ...(kbps ? ['-b:v', `${kbps}k`] : ['-crf', String(q)])];
      case 'libsvtav1': return ['-c:v', 'libsvtav1', '-preset', String(e.svt), '-pix_fmt', 'yuv420p10le',
        '-svtav1-params', ['tune=0', 'enable-overlays=1', 'scd=1', ...(kbps ? ['rc=1'] : [])].join(':'), ...(kbps ? ['-b:v', `${kbps}k`] : ['-crf', String(q)])];
      case 'libaom-av1': return ['-c:v', 'libaom-av1', '-cpu-used', String(e.aom), '-row-mt', '1', '-pix_fmt', 'yuv420p10le', '-aq-mode', '1',
        ...(kbps ? ['-b:v', `${kbps}k`] : ['-crf', String(q), '-b:v', '0'])];
      default: {
        const cq = s.codec === 'av1' ? q : crfFor('h264', s.q) + 1;
        if (enc.endsWith('_nvenc')) {
          // Highest-quality preset, a look-ahead, spatial AQ, and for size targets a full-resolution first pass.
          const common = ['-c:v', enc, '-preset', e.nv, '-tune', 'hq', '-rc-lookahead', '20', '-spatial-aq', '1'];
          return kbps ? [...common, '-rc', 'vbr', '-multipass', 'fullres', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.3)}k`, '-bufsize', `${kbps * 2}k`]
            : [...common, '-rc', 'vbr', '-cq', String(cq), '-b:v', '0'];
        }
        // AMD: constant bitrate for size targets (predictable), quality preset.
        if (kbps) return ['-c:v', enc, '-quality', 'quality', '-rc', 'cbr', '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps}k`];
        return ['-c:v', enc, '-quality', 'quality', '-rc', 'cqp', '-qp_i', String(cq), '-qp_p', String(cq + 2)];
      }
    }
  }
  /**
   * ffmpeg runs for one video → { encoder, kbps, height, fps, denoise, runs: [args, …] } (two runs for a
   * two-pass size target with x264 / x265).
   * info: { duration, hasAudio, audioCodec, width, height, fps, scale }, has(encoderName) → bool,
   * passlog: path prefix for two-pass stats.
   */
  function videoPlan(input, out, s, info, has, passlog, nullOut = 'NUL') {
    if (isFun(s)) return { encoder: 'libx264', kbps: funMaxrate(funOf('video', s).crush), runs: [funVideoArgs(input, out, s, info)] };
    const enc = pickEncoder(s.codec, s.hw, has);
    if (!enc) throw new Error(`No ${s.codec.toUpperCase()} encoder in this ffmpeg.`);
    const sizeMode = s.mode === 'size' && info.duration > 0;
    // Size mode: info.scale (< 1) shrinks the video bitrate when an earlier try came out too big.
    const sp = sizeMode ? sizePlan(s, info.duration, { height: info.height, width: info.width, fps: info.fps }, info.hasAudio) : null;
    const aK = sp ? sp.audioK : audioKbpsFor(s);
    const kbps = sp ? Math.max(16, Math.floor(sp.kbps * (info.scale || 1))) : null;
    // info.forceHeight: the height a trial picked (see pickHeightTrial in main.js); null = the source's.
    const height = info.forceHeight !== undefined ? info.forceHeight : sp ? sp.height : s.height && (!info.height || info.height > s.height) ? s.height : null;
    const fps = sp ? sp.fps : null;
    const denoise = info.denoise !== undefined ? info.denoise : sp ? sp.denoise : clamp(s.q, 0, 100) < 35;
    const chain = [
      ...(fps ? [`fps=${fps}`] : []),
      ...(height ? [`scale=-2:${height}:flags=lanczos`] : []),
      ...(denoise ? ['hqdn3d=1.5:1.5:4:4'] : []),
    ];
    const vf = chain.length ? ['-vf', chain.join(',')] : [];
    let audio;
    if (s.audio === 'mute' || !info.hasAudio) audio = ['-an'];
    else if (s.audio === 'keep' && !sizeMode && ['aac', 'mp3'].includes(String(info.audioCodec || '').toLowerCase())) audio = ['-c:a', 'copy'];
    else audio = ['-c:a', 'aac', '-b:a', `${aK || 128}k`];
    const base = ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:v:0', ...(info.hasAudio && s.audio !== 'mute' ? ['-map', '0:a:0'] : []), ...vf];
    const tail = ['-map_metadata', '0', '-movflags', '+faststart', out];
    const plan = { encoder: enc, kbps, height, fps, denoise, trial: sp ? sp.trial : [], srcH: sp ? sp.srcH : null };
    if (sizeMode && enc === 'libx264') {
      const v = encoderArgs(enc, s, kbps);
      return { ...plan, runs: [
        [...base, ...v, '-pass', '1', '-passlogfile', passlog, '-an', '-f', 'null', nullOut],
        [...base, ...v, '-pass', '2', '-passlogfile', passlog, ...audio, ...tail]] };
    }
    if (sizeMode && enc === 'libx265') {
      const stats = `${passlog}.x265`.replace(/\\/g, '/').replace(/:/g, '\\:');
      return { ...plan, runs: [
        [...base, ...encoderArgs(enc, s, kbps, `pass=1:stats=${stats}`), '-an', '-f', 'null', nullOut],
        [...base, ...encoderArgs(enc, s, kbps, `pass=2:stats=${stats}`), ...audio, ...tail]] };
    }
    return { ...plan, runs: [[...base, ...encoderArgs(enc, s, kbps), ...audio, ...tail]] };
  }

  // ---------- Images ----------
  const IMAGE_OUT = { jpeg: 'jpg', webp: 'webp', avif: 'avif' };
  function imageOutExt(input, s) {
    if (isFun(s)) return 'jpg'; // Fun: always a crunchy JPEG
    if (s.format !== 'keep') return IMAGE_OUT[s.format];
    const e = extOf(input);
    return ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(e) ? (e === 'jpeg' ? 'jpg' : e) : 'jpg'; // HEIC, BMP, TIFF → JPEG
  }
  function imageArgs(input, out, s) {
    if (isFun(s)) {
      const f = funOf('image', s), q = String(funJpegQ(f.crush)), vf = funScaleFilter(f.res);
      return ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:v:0', '-frames:v', '1', '-map_metadata', '-1', ...(vf ? ['-vf', vf] : []),
        '-c:v', 'mjpeg', '-pix_fmt', 'yuvj420p', '-q:v', q, '-qmin', q, '-qmax', q, out];
    }
    const ext = extOf(out);
    const q = clamp(s.q, 0, 100);
    const fit = s.maxSide ? `scale='if(gt(iw,ih),min(${s.maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${s.maxSide},ih))'` : null;
    const base = ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:v:0', '-frames:v', '1', '-map_metadata', '-1'];
    if (ext === 'jpg') return [...base, ...(fit ? ['-vf', fit] : []), '-c:v', 'mjpeg', '-pix_fmt', 'yuvj420p', '-q:v', String(Math.round(31 - q * 0.29)), out];
    if (ext === 'webp') return [...base, ...(fit ? ['-vf', fit] : []), '-c:v', 'libwebp', '-quality', String(Math.round(q)), '-compression_level', '6', out];
    if (ext === 'avif') return [...base, ...(fit ? ['-vf', fit] : []), '-c:v', 'libaom-av1', '-still-picture', '1', '-crf', String(Math.round(50 - q * 0.36)), '-cpu-used', '6', '-pix_fmt', 'yuv420p', out];
    // PNG: below "high" quality, reduce to a 256-colour palette (like pngquant); otherwise just recompress.
    if (q < 80) {
      const chain = `[0:v:0]${fit ? `${fit},` : ''}split[a][b];[a]palettegen=max_colors=256:reserve_transparent=1:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a[out]`;
      return ['-hide_banner', '-nostdin', '-y', '-i', input, '-filter_complex', chain, '-map', '[out]', '-frames:v', '1', '-map_metadata', '-1', '-c:v', 'png', '-compression_level', '9', out];
    }
    return [...base, ...(fit ? ['-vf', fit] : []), '-c:v', 'png', '-compression_level', '9', '-pred', 'mixed', out];
  }

  // ---------- Audio ----------
  const LOSSLESS_AUDIO = ['wav', 'flac', 'aiff', 'aif', 'ape'];
  function audioOutExt(input, s) {
    if (isFun(s)) return 'mp3';
    if (s.format === 'mp3') return 'mp3';
    if (s.format === 'aac') return 'm4a';
    if (s.format === 'opus') return 'opus';
    const e = extOf(input);
    if (e === 'm4a' || e === 'aac' || e === 'm4b') return 'm4a';
    if (e === 'ogg' || e === 'oga' || e === 'opus') return e === 'opus' ? 'opus' : 'ogg';
    return 'mp3'; // MP3 stays MP3; lossless and the rest become MP3
  }
  function audioArgs(input, out, s, info = {}) {
    if (isFun(s)) {
      // Compression slider → bitrate; Audio slider → sample rate, mono, bit-crusher.
      const f = funOf('audio', s), fa = funAudio(f.audio);
      const kbps = funAudio(100 - f.crush).kbps;
      return ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:a:0', '-af', funAudioFilter(fa), '-ar', String(fa.rate), ...(fa.mono ? ['-ac', '1'] : []),
        '-c:a', 'libmp3lame', '-b:a', `${Math.min(kbps, fa.rate <= 11025 ? 64 : 160)}k`, '-map_metadata', '0', '-id3v2_version', '3', out];
    }
    const ext = extOf(out);
    const kbps = clamp(Math.round(s.kbps || 128), 32, 320);
    const codec = ext === 'mp3' ? ['libmp3lame'] : ext === 'm4a' ? ['aac'] : ['libopus'];
    // MP3 / M4A keep the cover picture.
    const cover = info.hasCover && (ext === 'mp3' || ext === 'm4a') ? ['-map', '0:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic'] : [];
    return ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:a:0', ...cover, '-c:a', ...codec, '-b:a', `${kbps}k`,
      ...(s.mono ? ['-ac', '1'] : []), '-map_metadata', '0', ...(ext === 'mp3' ? ['-id3v2_version', '3'] : []), out];
  }

  // ---------- GIF ----------
  function gifArgs(input, out, s) {
    if (extOf(out) === 'mp4') {
      return ['-hide_banner', '-nostdin', '-y', '-i', input, '-vf', `${s.fps ? `fps=${s.fps},` : ''}scale=trunc(iw/2)*2:trunc(ih/2)*2`,
        '-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', out];
    }
    const colors = clamp(Math.round(s.colors || 128), 8, 256);
    return ['-hide_banner', '-nostdin', '-y', '-i', input, '-filter_complex',
      `${s.fps ? `fps=${s.fps},` : ''}split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop', '0', out];
  }

  // ---------- PDF (Ghostscript) ----------
  const PDF_PRESETS = ['screen', 'ebook', 'printer'];
  function pdfArgs(input, out, s) {
    const p = PDF_PRESETS.includes(s.preset) ? s.preset : 'ebook';
    return ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=/${p}`, '-dDetectDuplicateImages=true', '-dCompressFonts=true',
      '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${out}`, input];
  }

  // The result's extension.
  function outExt(input, kind, s) {
    if (kind === 'video') return 'mp4';
    if (kind === 'image') return imageOutExt(input, s);
    if (kind === 'audio') return audioOutExt(input, s);
    if (kind === 'gif') return s.toMp4 ? 'mp4' : 'gif';
    return 'pdf';
  }

  // Rough size of the result in bytes, for the screen ("~"). file: { kind, size, duration, width, height }.
  function estimate(f, s) {
    const size = f.size || 0;
    if (isFun(s) && f.kind !== 'gif' && f.kind !== 'pdf') {
      const fn = funOf(f.kind, s);
      if (f.kind === 'image') {
        const sz = funSize(f.width || 3000, f.height || 2000, fn.res);
        return Math.min(size, Math.max(400, (sz[0] * sz[1] * (0.05 + 1.2 * (1 - fn.crush / 100) ** 2)) / 8));
      }
      if (!f.duration) return size * 0.05;
      if (f.kind === 'audio') return Math.min(size, ((Math.min(funAudio(100 - fn.crush).kbps, funAudio(fn.audio).rate <= 11025 ? 64 : 160) * 1000) / 8) * f.duration + 2e3);
      const sz = funSize(f.width || 1920, f.height || 1080, fn.res);
      const vK = Math.min(funMaxrate(fn.crush), (sz[0] * sz[1] * 30 * (0.004 + 0.08 * (1 - fn.crush / 100) ** 2)) / 1000);
      return Math.min(size, ((vK + Math.max(16, funAudio(fn.audio).kbps)) * 1000 / 8) * f.duration);
    }
    if (f.kind === 'video') {
      if (!f.duration) return size * 0.4;
      if (s.mode === 'size') return Math.min(size, s.targetMB * 1e6 * 0.98);
      const px = (f.width || 1920) * (f.height || 1080);
      const h = s.height && f.height && f.height > s.height ? s.height : f.height || 1080;
      const scale = f.height ? (h / f.height) ** 2 : 1;
      // bits per pixel per frame at this quality, by codec (H.265 ≈ 0.6× H.264, AV1 ≈ 0.45×).
      const bpp = (0.012 + 0.06 * (clamp(s.q, 0, 100) / 100) ** 2) * { h264: 1, h265: 0.6, av1: 0.45 }[s.codec];
      const vBits = px * scale * 30 * bpp * f.duration;
      const aBits = audioKbpsFor(s) * 1000 * f.duration;
      return Math.min(size, (vBits + aBits) / 8);
    }
    if (f.kind === 'audio') {
      if (!f.duration) return size * 0.3;
      return Math.min(size, ((s.kbps * 1000) / 8) * f.duration * (s.mono ? 0.55 : 1) + 2e4);
    }
    if (f.kind === 'image') {
      const side = Math.max(f.width || 0, f.height || 0);
      const scale = s.maxSide && side > s.maxSide ? (s.maxSide / side) ** 2 : 1;
      const px = (f.width || 3000) * (f.height || 2000) * scale;
      const fmt = s.format === 'keep' ? imageOutExt(f.name || '', s) : IMAGE_OUT[s.format];
      const q = clamp(s.q, 0, 100) / 100;
      const bpp = fmt === 'png' ? (q < 0.8 ? 0.9 : 2.2) : (0.25 + 1.8 * q * q) * (fmt === 'webp' ? 0.7 : fmt === 'avif' ? 0.5 : 1);
      return Math.min(size, (px * bpp) / 8);
    }
    if (f.kind === 'gif') {
      if (s.toMp4) return size * 0.06;
      return size * (0.35 + 0.65 * (clamp(s.colors, 8, 256) / 256)) * (s.fps ? Math.min(1, s.fps / 20) : 1);
    }
    return size * { screen: 0.1, ebook: 0.25, printer: 0.6 }[s.preset || 'ebook'];
  }

  const api = { KINDS, DEFAULTS, isFun, funSize, funAudio, funCrf, funMaxrate, funJpegQ, kindOf, extOf, crfFor, pickEncoder, sizeBitrate, sizePlan, CODEC_GAIN, videoPlan, imageArgs, imageOutExt, audioArgs, audioOutExt, gifArgs, pdfArgs, outExt, estimate, LOSSLESS_AUDIO };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Compressor = api;
})(typeof self !== 'undefined' ? self : this);
