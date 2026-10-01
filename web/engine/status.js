// Requested mode and last reported acquisition are different states.
export function microphoneStatus(state) {
  const mode = state.mic?.mode || 'off', capture = !!state.device?.capture;
  if (!state.device?.connected && (capture || mode !== 'off'))
    return { active: true, label: 'MIC UNKNOWN / LINK LOST' };
  if (capture && mode === 'off') return { active: true, label: 'CAPTURE STOPPING' };
  if (state.mic?.error) return { active: capture, label: 'MIC ERROR' };
  if (mode !== 'off' && !capture) return { active: false, label: 'MIC WAITING' };
  if (mode === 'transcribe' && state.mic?.recognizer?.refine === 'loading') return { active: capture, label: 'TRANSCRIBING / LOADING' };
  return { active: capture, label: ({ off: 'MIC OFF', commands: 'VOICE ON', transcribe: 'TRANSCRIBING', analyze: 'ANALYZING' })[mode] || 'MIC OFF' };
}

// Which recognisers dictation is using, from state.mic.recognizer (the service's own report).
export function recognizerLabel(state) {
  const r = state.mic?.recognizer;
  if (!r) return '';
  return ({
    unavailable: 'RECOGNISER / VOSK ONLY',
    idle: 'RECOGNISER / VOSK + PARAKEET (LOADS ON START)',
    loading: 'RECOGNISER / VOSK LIVE, LOADING SECOND PASS',
    ready: 'RECOGNISER / VOSK LIVE + PARAKEET FINAL',
    failed: 'RECOGNISER / VOSK ONLY, SECOND PASS FAILED',
  })[r.refine] || 'RECOGNISER / VOSK';
}
